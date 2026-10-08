# notification-dispatcher

다수의 수신자에게 알림을 발송하는 NestJS 백엔드입니다. API 서버(`api`)는 알림을 만들고 발송을 시작·취소하고, 발송 워커(`worker`)는 별도 컨테이너에서 수신자별 발송을 처리합니다.

## 시스템 구성

```
              ┌──────────────┐
              │    Client    │
              └──────┬───────┘
                     │ HTTP :3000 (published port)
┌─ docker compose ───┼────────────────────────────────────────────────────────────────┐
│                    ▼                                                                │
│  ┌─ api ×1 ───────────────────────────┐     ┌─ worker ×N (--scale worker=3) ──────┐ │
│  │ /alarms        REST + OpenAPI      │     │ ExpansionLoop   users → deliveries  │ │
│  │ /livez /readyz probes              │     │ DispatchLoop    claim → send        │ │
│  │                                    │     │ ReconcileLoop   UNKNOWN → settle    │ │
│  └─────────────────┬──────────────────┘     └───────┬───────────────────┬─────────┘ │
│                    │                                │                   │           │
│                    │ 1 transaction                  │ SKIP LOCKED       │ HTTP      │
│                    │ alarm + deliveries             │ lease · tokens    │           │
│                    ▼                                ▼                   ▼           │
│  ┌─ PostgreSQL ───────────────────────────────────────────┐  ┌─ mock :4000 ──────┐  │
│  │ alarms                                                 │  │ GET  /v1/users    │  │
│  │ deliveries          (work queue, unique alarm+user)    │  │ POST /v1/messages │  │
│  │ recipient_expansions (cursor checkpoint)               │  │ GET  /v1/messages │  │
│  │ rate_limiters        (shared 50/s GCRA, Retry-After)   │  │      ?clientRef=  │  │
│  └────────────────────────────────────────────────────────┘  └───────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

- `api`와 `worker`는 같은 Dockerfile의 다른 target으로 빌드한 별도 이미지입니다.
- 별도 메시지 브로커 없이 **`deliveries` 테이블이 곧 작업 큐**입니다. 알림 상태 변경과 작업 생성이 한 트랜잭션에 들어가서, "상태는 바뀌었는데 작업은 없다" 같은 이중 쓰기 문제가 생기지 않습니다.
- 워커는 몇 대로 늘려도 `FOR UPDATE SKIP LOCKED`로 서로 다른 Delivery를 가져가고, 처리량은 PostgreSQL의 제한기 행 하나를 함께 씁니다.

## 아키텍처 원칙과 선택

이 구조는 하나의 공인 규격이 아니라, 원칙을 이 과제에 적용한 결과입니다. 원칙과 적용 방식, 의도한 타협과 그 이유를 나눠 적습니다.

```
┌─ adapter/in (driving) ─────────────┐      ┌─ adapter/out (driven) ─────────────┐
│ web    : controller · schema       │      │ persistence : Drizzle repositories │
│          presenter                 │      │               transaction          │
│ worker : expand · send             │      │               rate limiter         │
│          reconcile                 │      │ external-api: mock API adapters    │
│          lease recovery loops      │      │ system      : clock · id generator │
│                                    │      │ in-memory   : fakes for unit tests │
└──────────────────┬─────────────────┘      └──────────────────┬─────────────────┘
                   │ calls use cases                           │ implements ports
                   ▼                                           ▼
┌─ application ──────────────────────────────────────────────────────────────────┐
│ port/in  : CreateAlarm · GetAlarm · ListAlarms · StartDispatch · CancelAlarm   │
│            ExpandRecipients · SendNextDelivery · ReconcileNextDelivery         │
│            RecoverExpiredLease · CompleteAlarmIfSettled (+ result DTOs)        │
│ service  : implements port/in with the domain model                            │
│ port/out : AlarmRepository · ExpansionJobRepository · Transaction              │
│            DeliveryCreation · DispatchQueue · LeaseRecoveryQueue               │
│            ReconcileQueue · DeliveryCancellation · DeliveryProgress            │
│            RecipientDirectory · MessageSender (+ SendOutcome union)            │
│            MessageLookup · SendPermit · Clock · JitterSource                   │
│            AlarmId · DeliveryId · LeaseToken generators · settings             │
└────────────────────────────────────────┬───────────────────────────────────────┘
                                         │ uses
                                         ▼
┌─ domain ───────────────────────────────────────────────────────────────────────┐
│ Alarm (aggregate) · Delivery (aggregate) · state transitions · RetryPolicy     │
│ no Nest, no DB, no HTTP, no zod                                                │
└────────────────────────────────────────────────────────────────────────────────┘
```

### 원칙과 적용

| 원칙 (출처) | 이 프로젝트의 적용 |
| --- | --- |
| 의존성은 안쪽으로만 향한다 (Clean Architecture) | domain과 application은 Nest · DB · HTTP · zod를 모릅니다. 서비스는 일반 클래스이고, Nest 모듈이 `useFactory`로 조립합니다. |
| 애플리케이션과 바깥 기술을 port로 분리한다 (Ports & Adapters) | 모든 유스케이스는 들어오는 쪽 계약(`port/in`)을 갖고, controller와 워커 루프(driving adapter)는 이 계약에만 의존합니다. 나가는 쪽 계약은 `port/out`에 두고 driven adapter가 구현합니다. `port/in` · `adapter/out` 같은 폴더 이름은 원전이 정한 것이 아니라 이 프로젝트의 관례입니다. |
| 경계를 넘는 데이터는 단순한 구조로 (Clean Architecture) | 유스케이스의 입력과 결과는 application이 소유한 readonly 데이터(command, 결과 DTO)입니다. driving adapter는 도메인 타입을 import하지 않고, presenter는 결과 DTO만 HTTP 응답으로 바꿉니다. 저장소 같은 driven adapter는 Aggregate를 저장하고 복원하는 것이 역할이므로 도메인 타입을 씁니다. |
| Aggregate가 자기 불변식을 지킨다 (DDD) | Alarm은 상태 전이(DRAFT → DISPATCHING → COMPLETED / CANCELLED)를, Delivery는 시도 · lease · 결과 전이를 스스로 검사합니다. |
| Repository는 Aggregate를 저장하고 복원한다 (Evans · Fowler) | 저장소 port는 Aggregate를 주고받습니다. 같은 계약 테스트(`testing/contract/`)를 in-memory fake와 Drizzle adapter에 함께 돌립니다. |
| 쓰지 않는 의존성은 받지 않는다 (ISP) | port는 쓰는 쪽 기준으로 나눕니다. Delivery 저장소는 생성 · 발송 큐 · lease 복구 큐 · reconcile 큐 · 취소 · 진행 집계 port로 나뉘고, 구현 adapter 하나가 모두를 구현합니다. 메서드마다 port를 만들지는 않습니다. |

- port는 abstract class라서 그 자체를 Nest DI 토큰으로 씁니다(`{ provide: ClockPort, useClass: SystemClockAdapter }`). 구현은 `implements`만 쓰고, 구현을 물려받을 필요가 없으면 `extends`하지 않습니다.
- 성공과 실패는 예외 대신 `kind`로 구분하는 discriminated union으로 표현합니다. 외부 발송 결과(`SendOutcome = Accepted | PermanentFailure | TransientFailure | RateLimited | Unknown`)는 발송 port의 계약이므로 `port/out`에 둡니다.
- 트랜잭션은 필요한 일관성으로 정합니다. 여러 변경이 함께 성공해야 하면 `TransactionPort`가 한 트랜잭션 안의 저장소를 넘겨줍니다. `TransactionPort`는 변경 추적이 없는 트랜잭션 실행기로, Fowler의 Unit of Work와는 범위가 다릅니다.

### 의도한 타협

| 타협 | 원칙 | 이유 |
| --- | --- | --- |
| 발송 시작(Alarm 상태 변경 + Delivery 또는 확장 작업 생성)과 수신자 확장 페이지(Alarm 상태 잠금 조회 + Delivery 생성 + cursor 저장)를 한 트랜잭션에 저장 | Aggregate 사이는 최종 일관성을 권장 (DDD, Vernon) | "알림은 발송 중인데 발송 작업이 없는" 이중 쓰기 불일치를 막기 위해서입니다. 단일 PostgreSQL이라 브로커 없이 원자성을 얻을 수 있고, 상태 변경과 작업 생성이 함께 성공해야 하는 명령에만 씁니다. |

### 바깥 계층의 역할과 패키징 선택

아래는 원칙에서 벗어난 것이 아니라, 바깥 계층이 원래 맡는 일이거나 파일 배치의 선택입니다.

| 항목 | 설명 |
| --- | --- |
| 제한기 · claim · lease 복구의 시각을 DB 시계 기준으로 판정 | 여러 워커가 공유하는 상태라 서버마다 다른 시계로 판정하면 어긋납니다. 제한기는 persistence adapter의 SQL이 `clock_timestamp()`로 직접 판정하고, claim과 lease 복구는 application이 DB 시각을 받아 도메인 규칙과 조회 조건에 인자로 넘깁니다. 도메인 규칙은 여전히 시각을 인자로 받습니다. |
| health의 DB 확인이 Pool에 직접 의존 | 비즈니스 규칙이 없는 기술 관심사라 driven adapter(`adapter/out/persistence`)가 직접 확인합니다. |
| 종료 조율(bootstrap)이 Pool을 직접 닫음 | composition root의 일입니다. drain이 끝난 뒤, 감시 타이머가 살아 있는 동안 닫는 순서를 한 곳에서 보장합니다. |
| in-memory fake가 `adapter/out/in-memory`에 있음 | 같은 계약 테스트를 fake와 실제 adapter 양쪽에 돌리기 위해서입니다. 운영 조립에는 쓰지 않습니다. |

## 파일 구조

```
📦 notification-dispatcher
├── 📂 src/
│   ├── 📄 main.ts                                   api 엔트리포인트
│   ├── 📄 worker.ts                                 worker 엔트리포인트
│   ├── 📄 migrate.ts                                migration 엔트리포인트 (migrate 컨테이너)
│   ├── 📂 bootstrap/                                composition root
│   │   ├── 📄 api.module.ts
│   │   ├── 📄 worker.module.ts
│   │   ├── 📄 migrate.module.ts
│   │   ├── 📂 lifecycle/
│   │   │   ├── 📄 lifecycle.module.ts
│   │   │   └── 📄 shutdown.service.ts               신호 즉시 readiness down · drain · watchdog
│   │   └── 📂 server/
│   │       ├── 📄 server.bootstrap.ts               기동 · 기동 실패 처리 · 종료 hook(exit 0)
│   │       ├── 📄 listen-address.type.ts
│   │       └── 📄 listen-address.util.ts            Local/Network 주소 로그
│   ├── 📂 modules/
│   │   ├── 📂 health/                               /livez · /readyz · readiness 상태
│   │   │   ├── 📂 application/port/out/             readiness.port.ts
│   │   │   ├── 📂 adapter/
│   │   │   │   ├── 📂 in/web/                       controller · filter · readiness indicator
│   │   │   │   ├── 📂 out/persistence/              database.health-indicator (DB ping)
│   │   │   │   └── 📂 out/in-memory/                in-memory-readiness.adapter
│   │   │   └── 📄 health.module.ts
│   │   └── 📂 notification/                         알림 bounded context
│   │       ├── 📂 domain/
│   │       │   ├── 📂 alarm/                        alarm.entity (상태 전이 · 불변식) · type · predicate
│   │       │   └── 📂 delivery/                     delivery.entity (상태 전이 · lease) · retry-policy
│   │       ├── 📂 application/
│   │       │   ├── 📂 port/in/                      *.use-case.ts (유스케이스 계약) · command · 결과 DTO
│   │       │   ├── 📂 port/out/                     *.port.ts (저장소 · 트랜잭션 · 외부 API · 시계 · id)
│   │       │   └── 📂 service/                      *.service.ts (port/in 구현) · alarm-view.mapper
│   │       ├── 📂 adapter/
│   │       │   ├── 📂 in/web/                       controller · 요청 schema · presenter
│   │       │   ├── 📂 in/worker/                    확장 · 발송 · reconcile · lease 복구 루프
│   │       │   ├── 📂 out/persistence/              Drizzle 저장소 · 트랜잭션 · 테이블 · PG 제한기
│   │       │   ├── 📂 out/external-api/             mock 사용자 · 발송 · 조회 API adapter
│   │       │   ├── 📂 out/system/                   시계 · id 생성기
│   │       │   └── 📂 out/in-memory/                unit 테스트용 fake 저장소 · 트랜잭션
│   │       ├── 📂 testing/                          계약 테스트(contract/) · mock 컨테이너 · stub 서버
│   │       ├── 📄 notification-api.module.ts
│   │       └── 📄 notification-worker.module.ts
│   └── 📂 shared/
│       ├── 📂 config/                               zod env 스키마 · brand 타입 · TypedConfigService
│       ├── 📂 http/                                 RFC 9457 Problem Details · 요청 검증
│       ├── 📂 logging/                              Nest ConsoleLogger 기반 AppLogger
│       └── 📂 database/                             PostgreSQL Pool · 마이그레이션 실행기
├── 📂 drizzle/                                      마이그레이션 SQL
├── 📂 test/                                         e2e (api 전체 · 발송 전체 흐름)
├── 📄 Dockerfile                                    target: api · worker
├── 📄 docker-compose.yml                            api · worker · postgres · mock
├── 📄 vitest.config.mts                             unit · integration · characterization · e2e 프로젝트
├── 📄 SCENARIO.md                                   테스트 시나리오 (ID ↔ 테스트 이름)
└── 📄 README.md
```

테스트는 구현 파일 옆에 두고, 여러 구현이 함께 쓰는 계약 테스트와 테스트용 컨테이너만 `testing/`에 모읍니다.

| 종류 | 파일 | 실행 | 대상 | 컨테이너 |
| --- | --- | --- | --- | --- |
| unit | `*.spec.ts` | `pnpm test` | domain · use case (port는 in-memory fake) | 없음 |
| integration | `*.int-spec.ts` | `pnpm test:int` | adapter (Drizzle 저장소, 제한기, mock API adapter) | PostgreSQL · mock (Testcontainers) |
| characterization | `*.characterization.int-spec.ts` | `pnpm test:int` (integration 다음에 단독 실행) | mock 한도·발송 기록 시점, 제한기를 거친 처리량 | PostgreSQL · mock (Testcontainers) |
| e2e | `test/*.e2e-spec.ts` | `pnpm test:e2e` | HTTP 계약과 api + worker 전체 흐름 | PostgreSQL · mock (Testcontainers) |

- 컨테이너는 vitest `globalSetup`에서 실행 단위마다 한 번만 띄우고, 테스트 파일마다 별도 database를 써서 서로 섞이지 않게 합니다. mock은 `RATE_LIMIT` · `ERROR_RATE` · `TIMEOUT_RATE` 설정별로 따로 띄웁니다.
- 저장소 port의 계약 테스트(`testing/contract/`) 하나를 in-memory fake와 Drizzle adapter 양쪽에 돌려서, unit 테스트의 fake가 실제 구현과 같은 계약을 지킨다는 것을 보장합니다.
- pre-push hook이 integration과 e2e까지 돌리므로 push하려면 로컬에 Docker가 실행 중이어야 합니다.

## 발송 처리 설계

### 상태 모델

```
Alarm      DRAFT ─dispatch─▶ DISPATCHING ─(expanded + 0 unsettled)─▶ COMPLETED
             └──────────cancel──────┴──────────────────────────────▶ CANCELLED

Delivery   PENDING ─claim(leaseToken)─▶ IN_FLIGHT ─202──────────────▶ SENT
              ▲                            │ ─400───────────────────▶ FAILED
              │                            │ ─500/503/429─▶ RETRY_WAIT ─(due, claim)─▶ IN_FLIGHT
              │                            │ ─timeout/lease expired─▶ UNKNOWN
              └────────────────────────────┘
           UNKNOWN ─(after reconcileAt) found──▶ SENT
                   ─(after reconcileAt) none───▶ RETRY_WAIT | FAILED | CANCELLED
                   ─lookup failed──────────────▶ UNKNOWN (backoff, retry lookup)
                   ─(after confirm window)─────▶ UNCONFIRMED (terminal, needs review)
```

알림 완료 판정은 Alarm이 Delivery를 직접 읽지 않고, application의 완료 판정 유스케이스가 "확장 완료 여부"와 "미종결 Delivery 수"를 조회해 Alarm에 넘깁니다. 이 유스케이스는 발송 결과 확정, reconcile 확정, 확장 완료(수신자 0명 포함) 때마다 호출됩니다.

### 중복과 누락을 막는 방법

| 상황 | 처리 |
| --- | --- |
| 같은 수신자 두 번 생성 | `deliveries (alarm_id, recipient_id)` unique 제약 |
| 워커 두 대가 같은 Delivery를 가져감 | `FOR UPDATE SKIP LOCKED` + lease |
| lease를 잃은 워커의 늦은 결과 | claim마다 새 `leaseToken`을 발급하고, 결과는 토큰과 상태가 일치할 때만 저장 (fencing) |
| lease가 거의 끝난 상태에서 새 요청 | 남은 lease가 HTTP 최대 실행 시간보다 짧으면 요청을 시작하지 않음 |
| 500/503 | 외부 API가 "발송되지 않음"을 보장하므로 백오프 후 재전송 |
| 응답 타임아웃 · 연결 오류 · lease 만료 | **재전송하지 않고** `UNKNOWN`으로 둔 뒤, reconcile 가능 시각(마지막 요청 시작 또는 lease 만료 + `RECONCILE_DELAY_MS`) 이후 `GET /v1/messages?clientRef=`로 확인. 내역이 있으면 `SENT`, 없으면 최대 시도 횟수 안에서 재전송 |
| 발송 내역 조회 실패 | 빈 내역으로 보지 않고 `UNKNOWN` 유지, 백오프 후 다시 조회 |
| 확인 기간이 지나도 확정 못 함 | `UNCONFIRMED`로 종결. 실제로 나갔을 수 있으므로 `FAILED`와 구분해 집계하고 운영 확인 대상으로 둠 |
| 확장 도중 워커 종료 | 페이지마다 Delivery 생성과 cursor 저장을 한 트랜잭션으로 커밋하고 이어서 읽음. unique 제약으로 중복 생성 방지 |

`clientRef`에는 Delivery id를 씁니다. 외부 API는 중복을 막아주지 않지만 발송 내역을 `clientRef`로 조회할 수 있으므로, 보냈는지 모르는 건은 조회로 확정한 다음에만 재전송합니다.

**가정**: 클라이언트가 요청을 끊어도 서버는 이미 받은 요청을 계속 처리할 수 있으므로, reconcile 대기 시간은 클라이언트 타임아웃이 아니라 서버 쪽 근거로 정합니다. 근거는 mock 명세의 "타임아웃 건은 발송은 처리되고 응답만 최대 `TIMEOUT_MS`(30초) 늦게 온다"이고, `RECONCILE_DELAY_MS`(기본 35초)를 그보다 길게 둡니다. "발송 내역이 응답보다 먼저 기록된다"는 특성 테스트(EXT-11)로 확인합니다.

**한계**: 외부 API가 멱등성(idempotency key)을 지원하지 않으므로 exactly-once는 보장할 수 없습니다. 프로세스가 lease 확인 직후 요청 전송 직전에 오래 멈추면, 이전 워커의 늦은 요청이 복구 이후에 나갈 수 있습니다. 이런 중복은 reconcile 조회 때 같은 `clientRef` 내역이 2건 이상 나오면 기록하지만, 이미 `SENT`로 확정된 뒤 생긴 중복은 드러나지 않습니다. 알림 완료 후 `UNKNOWN` 이력이 있던 건만 다시 조회하는 사후 감사는 선택 구현으로 남겨 둡니다.

### 처리량 제한과 긴급 알림

- 초당 50건 한도는 모든 워커가 합쳐서 지켜야 하므로, PostgreSQL의 제한기 행 하나를 원자적 `INSERT … ON CONFLICT DO UPDATE … WHERE … RETURNING` 한 문장으로 나눠 씁니다.
- 용량 50, 초당 50개 보충인 일반 토큰 버킷은 첫 1초에 최대 100건이 나갈 수 있습니다. 그래서 GCRA(Generic Cell Rate Algorithm)로 burst 없이 허가 간격을 20ms로 고르게 띄워서 **임의의 1초 구간**에서 50건을 넘지 않게 합니다. 시각 판정은 워커 간 시계 차이를 피하려고 DB 시계(`clock_timestamp()`)로 합니다.
- mock의 한도 방식은 로컬 Docker 환경에서 별도로 측정했고, 관측 결과는 토큰 버킷(용량 약 50, 초당 50개 연속 보충)과 맞습니다.
  - 60건을 동시에 보내면 52건이 성공했습니다.
  - 50건으로 소진한 직후 10건을 보내면 약 5건, 400ms 지나 30건을 보내면 약 25건이 성공했고, 3회 반복해도 성공 건수가 경과 시간 × 50/s에 맞았습니다.
  - 벽시계 기준 x.100초에 50건으로 소진한 뒤에도 약 150ms 만에 다시 성공했습니다. 벽시계 초 단위의 고정 구간이라면 다음 초까지 거부됐을 것입니다.
  - 429의 `Retry-After`는 매번 `1`이었습니다.
- 특성 테스트(EXT-10)는 알고리즘을 구별하지 않고, 우리 제한기를 거친 부하(동시 발송 20개, 제한기 없이는 429가 나는 수준)에서 2초 동안 429가 없고 한도의 80% 이상 성공하는지만 확인합니다. 위 환경에서는 20ms 간격 허가가 응답 지연으로 좁아져도 429가 관측되지 않았습니다.
- burst가 없는 허가는 늦게 나간 만큼을 만회하지 않으므로, 동시 요청자가 적으면 처리량이 한도보다 낮아집니다(같은 환경에서 동시 발송 3개 약 75%, 6개 약 88%, 20개 약 95%). 한도 준수를 우선해 burst를 허용하지 않고, 처리량은 워커의 동시 발송 수로 맞춥니다.
- 429를 받으면 제한기에 `Retry-After`만큼 정지 시각을 기록해서 모든 워커가 함께 멈춥니다. 더 짧은 `Retry-After`가 와도 정지 시각을 앞당기지 않습니다.
- 긴급 알림의 우선 처리는 "발송 가능한 긴급 Delivery가 있는 동안, 발송 허가를 얻은 요청은 긴급 Delivery를 보낸다"로 정의합니다. 이미 시작된 요청은 되돌릴 수 없으므로 제외하고, 재시도 대기 중인 긴급 건은 대량 발송을 막지 않습니다.
- 이를 위해 워커는 **발송 허가를 먼저 얻고, 그 시점에 발송 가능한 Delivery 중 우선순위가 가장 높은 1건을 claim해 바로 보냅니다.** 대량 건을 claim해 둔 채 허가를 기다리면, 그사이 생긴 긴급 건을 앞지르기 때문입니다.

## 기술 선택

| 영역 | 선택 | 이유 |
| --- | --- | --- |
| 언어 · 프레임워크 | TypeScript 7 · NestJS 12 | 과제 필수. TS7(tsgo)로 빠른 타입 검사 |
| 빌드 · 테스트 변환 | SWC | TS7에는 compiler API가 없어 Nest CLI 빌드 대신 SWC로 빌드하고 `tsc --noEmit`으로 타입만 검사 |
| 저장소 · 큐 | PostgreSQL | 상태와 작업 큐를 한 트랜잭션에 두어 원자성 확보. 인프라 하나로 동시성 · 장애 복구 · 처리량 공유를 설명 가능 |
| DB 접근 | Drizzle ORM 0.45 | 순수 TS(코드 생성 없음), `FOR UPDATE SKIP LOCKED` 지원, SQL 마이그레이션 생성 |
| 설정 | zod + `@nestjs/config` | 기동 시 env 검증, brand 타입(`Port`, `Milliseconds`)으로 검증된 값만 흐르게 함 |
| 입력 검증 | Nest `StandardSchemaValidationPipe` + zod | Nest 12 내장 기능으로 `@Body({ schema })` 검증 |
| 에러 응답 | RFC 9457 Problem Details | 표준 형식(`application/problem+json`) + `code`, `errors[]` 확장 |
| 테스트 | Vitest · pactum · Testcontainers | 실제 PostgreSQL과 mock 서버로 동시성 · 장애를 검증 |
| 린트 · 훅 | oxlint(type-aware) · prettier · husky · lint-staged | ESLint가 TS7을 지원하지 않음. 커밋마다 lint/format, push 전에 typecheck와 전체 테스트 |

## 실행 방법

```bash
docker compose up --build
```

```bash
docker compose up --build --scale worker=3
```

compose는 `postgres`가 healthy가 되면 일회성 `migrate`를 실행하고, `migrate`가 성공적으로 끝난 뒤 `api`와 `worker`를 띄웁니다. `worker`는 외부 발송 API인 `mock`이 healthy가 될 때까지도 기다립니다.

PostgreSQL 데이터는 이름 있는 볼륨(`postgres_data`)에 저장되어 `docker compose down` 후에도 남습니다. 처음 상태로 되돌리려면 `docker compose down -v`로 볼륨까지 지웁니다.

로컬 개발: 도구 버전(node 24.21.0, pnpm 10.34.5)은 `mise.toml`로 고정되어 있습니다.

```bash
mise install
```

```bash
pnpm install
```

로컬 PostgreSQL은 compose의 `postgres` 서비스만 띄워서 씁니다.

```bash
docker compose up -d postgres
```

api와 worker는 기동할 때 env를 검증하고, PostgreSQL 접속 주소 `DATABASE_URL`은 기본값 없는 필수값입니다. `.env` 파일은 읽지 않으므로 셸에서 지정합니다.

```bash
export DATABASE_URL=postgres://notification:notification@localhost:5432/notification
```

스키마는 앱이 기동할 때 바꾸지 않고, 별도의 일회성 migration 프로세스로 적용합니다. api와 worker를 여러 개 띄워도 migration이 동시에 실행되지 않게 하려는 것입니다(Drizzle의 `migrate()`는 잠금을 잡지 않습니다).

```bash
pnpm db:migrate
```

api와 worker를 함께 실행합니다. 처음 한 번 빌드한 뒤 SWC watch 하나가 `dist/`를 갱신하고, 두 프로세스가 변경을 감지해 재시작합니다.

```bash
pnpm dev
```

하나만 실행할 때는 `dev:api` 또는 `dev:worker`를 씁니다. 둘은 각자 `dist/`를 다시 빌드하므로 동시에 띄우지 않습니다.

```bash
pnpm dev:api
```

```bash
pnpm dev:worker
```

```bash
pnpm test && pnpm test:int && pnpm test:e2e
```

## API

OpenAPI 문서는 `/docs`(UI)와 `/docs-json`에서 제공합니다. 계약은 [SCENARIO.md](SCENARIO.md)의 `API-*` 시나리오로 정의되어 있습니다.

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `POST` | `/alarms` | 알림 생성 (대량 / 긴급) |
| `GET` | `/alarms` | 알림 목록 (status · kind 필터, cursor 페이지네이션) |
| `GET` | `/alarms/:id` | 알림 단건 (Delivery 상태별 집계 포함) |
| `POST` | `/alarms/:id/dispatch` | 발송 시작 |
| `POST` | `/alarms/:id/cancel` | 발송 취소 |
| `GET` | `/livez` · `/readyz` | liveness(의존성을 보지 않음) · readiness(종료 중이거나 DB에 1초 안에 쿼리할 수 없으면 503) 프로브 |

에러는 RFC 9457 Problem Details로 응답합니다. 예외는 `/livez` · `/readyz`로, k8s 프로브가 기대하는 terminus 형식을 그대로 유지합니다. 도메인 오류는 `ALARM_NOT_FOUND`(404), `ALARM_STATE_CONFLICT`(409)처럼 HTTP 상태와 `code`로 바꿔 응답합니다.

```json
{
  "type": "about:blank",
  "title": "Bad Request",
  "status": 400,
  "detail": "요청 값이 올바르지 않습니다",
  "instance": "/alarms",
  "code": "VALIDATION_FAILED",
  "errors": [{ "field": "title", "message": "Too small: expected string to have >=1 characters" }]
}
```
