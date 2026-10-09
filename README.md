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
│  │ /alarms        REST + OpenAPI      │     │ expansion       users → deliveries  │ │
│  │ /livez /readyz probes              │     │ dispatch ×8     permit → claim→send │ │
│  │                                    │     │ reconcile       UNKNOWN → settle    │ │
│  │                                    │     │ lease recovery  expired → UNKNOWN   │ │
│  │                                    │     │ completion      settled → COMPLETED │ │
│  └─────────────────┬──────────────────┘     └───────┬───────────────────┬─────────┘ │
│                    │                                │                   │           │
│                    │ 1 transaction                  │ SKIP LOCKED       │ HTTP      │
│                    │ alarm + deliveries             │ lease · tokens    │           │
│                    ▼                                ▼                   ▼           │
│  ┌─ PostgreSQL ───────────────────────────────────────────┐  ┌─ mock :4000 ──────┐  │
│  │ alarms                                                 │  │ GET  /v1/users    │  │
│  │ deliveries          (work queue, unique alarm+user)    │  │ POST /v1/messages │  │
│  │ expansion_jobs       (cursor checkpoint · lease)       │  │ GET  /v1/messages │  │
│  │ rate_limiters        (shared 50/s GCRA, Retry-After)   │  │      ?clientRef=  │  │
│  └────────────────────────────────────────────────────────┘  └───────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

- `api`와 `worker`는 같은 Dockerfile의 다른 target으로 빌드한 별도 이미지입니다.
- 별도 메시지 브로커 없이 **`deliveries` 테이블이 곧 작업 큐**입니다. 알림 상태 변경과 작업 생성이 한 트랜잭션에 들어가서, "상태는 바뀌었는데 작업은 없다" 같은 이중 쓰기 문제가 생기지 않습니다.
- 워커는 몇 대로 늘려도 `FOR UPDATE SKIP LOCKED`로 서로 다른 Delivery를 가져가고, 처리량은 PostgreSQL의 제한기 행 하나를 함께 씁니다.

## 아키텍처 원칙과 선택

이 구조는 하나의 공인 규격이 아니라, 원칙을 이 서비스에 적용한 결과입니다. 원칙과 적용 방식, 의도한 타협과 그 이유를 나눠 적습니다.

```
┌─ adapter/in (driving) ─────────────┐      ┌─ adapter/out (driven) ─────────────┐
│ web    : controller · schema       │      │ persistence : Drizzle repositories │
│          presenter                 │      │               transaction          │
│ worker : polling loops (expand ·   │      │               rate limiter         │
│          send · reconcile · lease  │      │ external-api: mock API adapters    │
│          recovery · completion)    │      │ system      : clock · id · settings│
│                                    │      │ in-memory   : fakes for unit tests │
└──────────────────┬─────────────────┘      └──────────────────┬─────────────────┘
                   │ calls use cases                           │ implements ports
                   ▼                                           ▼
┌─ application ──────────────────────────────────────────────────────────────────┐
│ port/in  : CreateAlarm · GetAlarm · ListAlarms · StartDispatch · CancelAlarm   │
│            ExpandNextPage · SendNextDelivery · ReconcileNextDelivery           │
│            RecoverExpiredLease · CompleteSettledAlarms (+ result DTOs)         │
│ service  : implements port/in with the domain model                            │
│ port/out : AlarmRepository · ExpansionJobRepository · ExpansionQueue           │
│            Transaction                                                         │
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
- 트랜잭션은 필요한 일관성으로 정합니다. 여러 변경이 함께 성공해야 하면 `TransactionPort`가 한 트랜잭션 안의 저장소를 넘겨줍니다. 알림 상태와 Delivery 집계처럼 같은 시점의 값이 필요한 조회는 `readSnapshot`(PostgreSQL `REPEATABLE READ`, `READ ONLY`)으로 읽어, 두 조회 사이에 워커가 커밋해도 서로 어긋난 값이 섞이지 않게 합니다. `readSnapshot`은 조회용 port(`AlarmReader`, `DeliveryProgress`)만 넘겨서 스냅샷 안에서의 쓰기를 타입 단계에서 막습니다. `TransactionPort`는 변경 추적이 없는 트랜잭션 실행기로, Fowler의 Unit of Work와는 범위가 다릅니다.

### 호출 흐름

API와 워커는 같은 유스케이스 계약(`port/in`)을 통해 같은 도메인 규칙과 저장소를 씁니다. 트랜잭션 경계는 유스케이스가 정하고, 외부 HTTP 호출은 항상 트랜잭션 밖에서 합니다.

| 진입점 | 유스케이스 | 한 트랜잭션에서 하는 일 | 트랜잭션 밖에서 하는 일 |
| --- | --- | --- | --- |
| `POST /alarms` | CreateAlarm | 알림 생성(`DRAFT`) | - |
| `POST /alarms/:id/dispatch` | StartDispatch | 알림 잠금 → `DISPATCHING`, 긴급이면 수신자별 Delivery 생성, 대량이면 확장 작업 등록 | - |
| `POST /alarms/:id/cancel` | CancelAlarm | 알림 잠금 → `CANCELLED`, 대기 중인 Delivery 일괄 `CANCELLED` (확장 작업은 다음 페이지를 저장할 때 알림 상태를 보고 스스로 멈춤) | - |
| `GET /alarms/:id` | GetAlarm | 알림과 상태별 Delivery 수를 같은 스냅샷에서 조회 | - |
| 워커 확장 루프 | ExpandNextPage | ① 확장 작업 하나를 lease로 claim ② 알림이 아직 발송 중인지 확인 → Delivery 생성 → cursor 저장 · lease 해제 | ①과 ② 사이에 mock 사용자 API 한 페이지 조회 |
| 워커 발송 루프 ×N | SendNextDelivery | ① 우선순위가 가장 높은 1건 claim(새 leaseToken) · 요청 시작 기록 ② leaseToken이 그대로일 때만 결과 저장 | 처리량 허가 획득(①보다 먼저), 남은 lease 재확인, mock 발송 요청 |
| 워커 reconcile 루프 | ReconcileNextDelivery | 확인 시각이 지난 `UNKNOWN` 1건을 골라 조회 결과로 확정(버전 비교) | mock 발송 내역 조회 |
| 워커 lease 복구 루프 | RecoverExpiredLease | lease가 만료된 `IN_FLIGHT` 1건을 `UNKNOWN`으로 | - |
| 워커 완료 확인 루프 | CompleteSettledAlarms | 발송 중인 알림 한 페이지를 훑으며 알림마다 잠금 → 확장 완료 · 미종결 0건이면 `COMPLETED` | - |

### 변경 영향 범위

| 바꾸고 싶은 것 | 고치는 곳 | 그대로인 곳 |
| --- | --- | --- |
| 외부 발송 서비스(예: FCM, SENS) | `adapter/out/external-api`에 `MessageSenderPort` · `MessageLookupPort` 구현 추가, 워커 모듈 바인딩 | domain · application · DB |
| 처리량 한도 · lease · 재시도 · reconcile 시간 | env(`RATE_LIMIT_INTERVAL_MS`, `DISPATCH_LEASE_MS`, `RETRY_*`, `RECONCILE_DELAY_MS` 등). 기동 시 서로 맞지 않는 조합은 거부 | 코드 |
| 워커 대수 · 워커당 동시 발송 수 | `docker compose up --scale worker=N`, `DISPATCH_CONCURRENCY` | 코드 · 스키마 |
| 우선순위 규칙 | `priority_rank` 생성식과 claim 정렬(같은 열 하나) | 발송 · 재시도 · reconcile 로직 |
| 저장소 기술 | `adapter/out/persistence`, 같은 계약 테스트(`testing/contract/`)로 검증 | domain · application · 다른 adapter |
| HTTP 응답 모양 | presenter와 응답 타입 | 유스케이스 · 도메인 |
| 상태 전이 규칙 | `Alarm` · `Delivery` 엔티티 하나 | 전이를 부르는 유스케이스는 결과 union만 다룸 |

### 의도한 타협

| 타협 | 원칙 | 이유 |
| --- | --- | --- |
| 발송 시작(Alarm 상태 변경 + Delivery 또는 확장 작업 생성)과 수신자 확장 페이지(Alarm 상태 잠금 조회 + Delivery 생성 + cursor 저장)를 한 트랜잭션에 저장 | Aggregate 사이는 최종 일관성을 권장 (DDD, Vernon) | "알림은 발송 중인데 발송 작업이 없는" 이중 쓰기 불일치를 막기 위해서입니다. 단일 PostgreSQL이라 브로커 없이 원자성을 얻을 수 있고, 상태 변경과 작업 생성이 함께 성공해야 하는 명령에만 씁니다. |

### 바깥 계층의 역할과 패키징 선택

아래는 원칙에서 벗어난 것이 아니라, 바깥 계층이 원래 맡는 일이거나 파일 배치의 선택입니다.

| 항목 | 설명 |
| --- | --- |
| 처리량 제한기만 DB 시계로 판정 | 제한기는 20ms 간격으로 허가를 나누므로 워커 사이의 ms 단위 시계 차이도 한도 초과로 이어질 수 있습니다. 그래서 persistence adapter의 SQL이 `clock_timestamp()`로 직접 판정합니다. claim · lease 복구 · reconcile은 워커의 시스템 시계(`ClockPort`)로 판정하고, 워커 호스트가 NTP로 동기화되어 있다고 가정합니다. 이 판정의 단위는 lease 30초 · reconcile 지연 35초여서 수 ms의 차이는 결과를 바꾸지 않고, 시계가 크게 어긋나도 leaseToken fencing이 늦은 결과의 저장을 막습니다. 도메인 규칙은 시각을 인자로 받으므로 시각의 출처를 바꿔도 도메인은 그대로입니다. |
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
│   │   ├── 📂 server/
│   │   │   ├── 📄 server.bootstrap.ts               기동 · 기동 실패 처리 · 종료 hook(exit 0)
│   │   │   ├── 📄 api-documentation.bootstrap.ts    OpenAPI 3.0 문서 · Swagger UI
│   │   │   └── 📄 listen-address.util.ts            Local/Network 주소 로그
│   │   └── 📂 testing/                              worker.process (e2e용 실제 worker 자식 프로세스)
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
│   │       │   ├── 📂 in/worker/                    폴링 루프 · 발송 워커(확장 · 발송 · reconcile · lease 복구 · 완료 확인)
│   │       │   ├── 📂 out/persistence/              Drizzle 저장소 · 트랜잭션 · 테이블 · PG 제한기
│   │       │   ├── 📂 out/external-api/             mock 사용자 · 발송 · 조회 API adapter
│   │       │   ├── 📂 out/system/                   시계 · id · lease token · 지터 · 워커 설정
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
├── 📂 test/                                         e2e (REST API · 발송 전체 흐름 · worker 프로세스 종료)
├── 📄 Dockerfile                                    target: api · worker · migrate
├── 📄 docker-compose.yml                            api · worker · migrate · postgres · mock
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
| e2e | `test/*.e2e-spec.ts` | `pnpm test:e2e` | HTTP 계약, 실제 worker 프로세스(1~3대)로 발송 전체 흐름 · 강제 종료 · 취소 · SIGTERM | PostgreSQL · mock (Testcontainers) |

- PostgreSQL은 vitest `globalSetup`에서 실행 단위마다 한 번 띄우고 마이그레이션한 템플릿 DB를 만든 뒤, 테스트 파일마다 템플릿을 복제한 별도 database를 써서 서로 섞이지 않게 합니다. mock은 필요한 테스트에서 `USER_COUNT` · `ERROR_RATE` · `TIMEOUT_RATE` 등 시나리오에 맞는 설정으로 따로 띄웁니다.
- e2e의 worker는 테스트가 `src`를 SWC로 빌드해 실제 자식 프로세스로 띄웁니다. 발송 횟수는 DB가 아니라 mock의 발송 내역(`GET /v1/messages?clientRef=`)으로 Delivery마다 셉니다.
- 저장소 port의 계약 테스트(`testing/contract/`) 하나를 in-memory fake와 Drizzle adapter 양쪽에 돌려서, unit 테스트의 fake가 실제 구현과 같은 계약을 지킨다는 것을 보장합니다.
- pre-push hook이 integration과 e2e까지 돌리므로 push하려면 로컬에 Docker가 실행 중이어야 합니다.

## 데이터 모델과 스키마

마이그레이션 SQL은 [`drizzle/`](drizzle)에, 테이블 정의는 `src/modules/notification/adapter/out/persistence/*.table.ts`에 있습니다.

```
alarms 1 ──── N deliveries          (알림 하나 = 수신자별 Delivery 여러 개, 작업 큐를 겸함)
alarms 1 ──── 0..1 expansion_jobs   (대량 알림만, 수신자 확장 진행 상황)
rate_limiters                       (모든 워커가 함께 쓰는 처리량 제한기 행)
```

| 테이블 | 키 | 담는 것 |
| --- | --- | --- |
| `alarms` | PK `id`(uuid, 앱에서 생성) | 제목 · 본문 · 종류(`BULK`/`URGENT`) · 긴급 수신자 목록 · 상태와 전이 시각(`dispatched_at` · `completed_at` · `cancelled_at`) |
| `deliveries` | PK `id`(uuid) = 외부 API의 `clientRef`, FK `alarm_id`, UNIQUE `(alarm_id, recipient_id)` | 수신자 1명에 대한 발송 1건의 상태 · 시도 횟수 · lease · 재시도 · reconcile · 결과 |
| `expansion_jobs` | PK이자 FK `alarm_id` (알림당 하나) | 사용자 목록 cursor · 진행 상태 · 확장 lease |
| `rate_limiters` | PK `name` | GCRA의 다음 허가 시각 · 429로 정지된 시각 |

### 상태 표현

- 도메인에서 상태는 상태별로 필요한 값만 가진 판별 union입니다(예: `SENT`는 `messageId` · `sentAt` · `duplicateCount`, `RETRY_WAIT`는 `retryAt` · `retryCause`). DB에서는 `status` 열 하나와 상태별 열로 펼치고, **상태별로 반드시 있어야 하는 열을 CHECK 제약으로 강제**합니다. 예를 들어 `status = 'SENT'`인데 `message_id`가 없는 행은 DB가 거부합니다. 도메인 규칙을 거치지 않은 쓰기나 매퍼의 실수가 있어도 불가능한 상태 조합이 저장되지 않습니다.
- `deliveries.id`를 `clientRef`로 보내므로, Delivery 행과 외부 발송 내역이 1:1로 연결됩니다. 응답을 받지 못한 건은 이 값으로 발송 내역을 조회해 확정합니다.
- `priority_rank`는 `priority`에서 계산되는 열(긴급 0, 대량 1)입니다. claim 정렬과 인덱스를 같은 열로 맞추려고 둡니다.
- 확장 작업은 `IN_PROGRESS`(cursor 필수) · `COMPLETED` · `STOPPED`(취소로 중단)이고, 다음 페이지 cursor와 확장 lease를 함께 저장해 어느 워커든 마지막으로 커밋한 페이지부터 이어받습니다.

### 키 · 관계 · 인덱스의 이유

| 대상 | 이유 |
| --- | --- |
| UNIQUE `(alarm_id, recipient_id)` | 같은 알림에서 같은 수신자의 Delivery는 하나뿐이어야 합니다. 확장이 도중에 끊겨 같은 페이지를 다시 읽어도 `ON CONFLICT DO NOTHING`으로 중복 생성되지 않습니다. 알림별 집계(상태별 개수, 미종결 개수)도 `alarm_id`가 앞 열인 이 인덱스를 쓸 수 있습니다. |
| `deliveries_claimable_idx` `(priority_rank, created_at, id) WHERE status IN ('PENDING','RETRY_WAIT')` | claim 쿼리의 정렬(긴급 먼저 → 오래된 것 먼저)과 같은 순서의 부분 인덱스입니다. 종결된 행이 수십만 건 쌓여도 인덱스에는 대기 건만 남습니다. |
| `deliveries_reconcilable_idx` `(reconcile_at, id) WHERE status = 'UNKNOWN'` | reconcile 대상(확인 시각이 지난 `UNKNOWN`)만 찾습니다. |
| `deliveries_leased_idx` `(lease_expires_at, id) WHERE status = 'IN_FLIGHT'` | lease가 만료된 `IN_FLIGHT`(워커가 멈춘 건)만 찾습니다. |
| `alarms_created_at_id_idx` `(created_at, id)` | 목록 조회의 cursor(`created_at`, `id`) 행 비교와 정렬에 씁니다. |
| `expansion_jobs_claimable_idx` `(enqueued_at, alarm_id) WHERE status = 'IN_PROGRESS'` | 진행 중인 확장 작업 중 잡을 수 있는 것을 오래된 순으로 찾습니다. |
| FK `alarm_id` (`ON DELETE NO ACTION`) | Delivery나 확장 작업이 남은 알림은 지울 수 없습니다. 발송 이력이 고아가 되거나 함께 사라지지 않게 합니다. |

Delivery 10만 건에서 claim · reconcile · lease 복구 쿼리가 각각 위 부분 인덱스를 Index Scan으로 쓰는 것을 `EXPLAIN`으로 확인했습니다(읽은 buffer 1~4).

### 변경 · 삭제 후의 정보 보존

- 행을 지우는 경로가 없습니다. API에 삭제가 없고, 취소는 알림을 `CANCELLED`로, 대기 중인 Delivery를 `CANCELLED`로 바꿀 뿐 행은 남습니다. FK가 삭제도 막습니다.
- 알림의 제목 · 본문 · 수신자는 생성 후 바꾸는 API가 없습니다. 발송된 내용과 저장된 내용이 어긋나지 않습니다.
- 대량 알림의 수신자는 확장 시점의 사용자 목록으로 Delivery를 만들어 고정합니다. 이후 사용자 목록이 바뀌어도 이 알림의 대상은 바뀌지 않습니다.
- 종결 상태는 결과를 남깁니다. `SENT`는 messageId · 실제 발송 시각 · 같은 `clientRef` 중복 건수, `FAILED`는 사유, `UNCONFIRMED`는 결과 불명이 시작된 시각, `CANCELLED`는 취소 시각을 보존하고, `attempts`는 요청 시작을 기록한 횟수를 누적합니다(발송 직전 lease가 부족해 보내지 않은 드문 경우도 한 번으로 셉니다).
- 보존하지 않는 것도 있습니다. Delivery는 현재 상태 열을 덮어쓰므로, 한 건이 거쳐 간 중간 경과(예: 타임아웃으로 `UNKNOWN`이 된 뒤 reconcile로 `SENT`)와 시도별 응답은 남지 않습니다. 시도 이력이 필요하면 상태 전이마다 한 행을 추가하는 append-only 테이블을 둘 계획입니다([시간이 더 있다면](#시간이-더-있다면)).

### 빈 DB에서의 재현

- 스키마는 [`drizzle/`](drizzle)의 순서 있는 SQL 마이그레이션(`0000` ~ `0004`)만으로 만들어집니다. 시드 데이터가 필요 없고, 제한기 행은 첫 발송 허가 때 `INSERT … ON CONFLICT`로 생깁니다.
- `docker compose up`은 빈 볼륨에서 `postgres` → 일회성 `migrate` → `api` · `worker` 순서로 기동합니다. 마이그레이션은 앱 기동과 분리되어 있어 api · worker를 여러 개 띄워도 동시에 실행되지 않습니다.
- 빈 DB에 마이그레이션을 적용하면 테이블이 만들어지고 다시 실행해도 그대로인지를 통합 테스트로 확인하고, 모든 통합 · e2e 테스트도 빈 템플릿 DB에 마이그레이션을 적용한 뒤 실행합니다.

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

알림 완료 판정은 Alarm이 Delivery를 직접 읽지 않고, application의 완료 판정 유스케이스가 "확장 완료 여부"와 "미종결 Delivery 수"를 조회해 Alarm에 넘깁니다. 워커는 이 판정을 결과가 확정될 때마다 호출하지 않고, 발송 중인 알림을 100개씩 페이지로 훑으며 호출합니다. 다음 페이지가 있으면 바로 이어서 확인하고, 끝까지 확인하면 `COMPLETION_CHECK_INTERVAL_MS`(기본 1초)만큼 쉰 뒤 처음부터 다시 확인합니다. 결과마다 호출하면 수신자 10만 명인 알림 하나에서 미종결 건수 집계가 10만 번 실행되기 때문입니다. 대신 마지막 결과가 확정된 뒤 `COMPLETED`가 되기까지 한 바퀴 순회 시간과 확인 간격만큼 늦어질 수 있습니다. 한 번에 한 페이지만 처리하므로 종료할 때도 진행 중인 페이지까지만 기다리고, 알림 하나의 판정이 실패해도 경고 로그를 남기고 다음 알림을 확인합니다.

### 워커 실행과 종료

워커 프로세스 하나는 폴링 루프 여러 개를 돌립니다. 각 루프는 할 일을 처리했으면 바로 다시, 할 일이 없으면 `WORKER_POLL_INTERVAL_MS`(기본 100ms) 뒤에, 예외가 나면 로그를 남기고 `WORKER_ERROR_DELAY_MS`(기본 1초) 뒤에 다시 실행합니다.

| 루프 | 개수 | 한 번에 하는 일 |
| --- | --- | --- |
| 확장 | 1 | 확장 작업 한 페이지(사용자 1,000명) |
| 발송 | `DISPATCH_CONCURRENCY`(기본 8) | 허가 1개 → Delivery 1건 claim → 발송 → 결과 저장 |
| reconcile | 1 | `UNKNOWN` 1건 확정 |
| lease 복구 | 1 | 만료된 lease 1건 |
| 완료 확인 | 1 | 발송 중인 알림 한 페이지(100개), 끝까지 확인하면 `COMPLETION_CHECK_INTERVAL_MS`(기본 1초) 쉼 |

종료는 Nest의 lifecycle 단계 순서를 그대로 씁니다. 같은 단계 안의 순서는 모듈의 깊이와 등록 순서(import 순서가 영향을 줌), 모듈 안에서는 provider 의존 단계로 정해지고 같은 의존 단계끼리는 병렬로 실행됩니다. 이 순서에 기대지 않도록, 앞뒤가 중요한 일은 서로 다른 단계에 둡니다.

1. 종료 신호를 받는 즉시 readiness를 내리고, 제한 시간(`SHUTDOWN_DRAIN_MS` + `SHUTDOWN_TIMEOUT_MS`)을 재는 감시 타이머를 시작합니다.
2. `onModuleDestroy`: 모든 루프에 정지를 알려 새 claim을 멈추고, 진행 중인 발송 요청과 결과 저장이 끝날 때까지 기다립니다.
3. `beforeApplicationShutdown`: drain 시간만큼 기다립니다.
4. `onApplicationShutdown`: DB 연결을 닫고, 프로세스는 exit 0으로 끝납니다.
5. 제한 시간 안에 끝나지 않으면 exit 1로 강제 종료합니다. 결과를 저장하지 못한 Delivery는 lease를 가진 채 남고, lease가 만료되면 다른 워커가 `UNKNOWN`으로 복구해 발송 내역 조회로 확정합니다.

readiness를 내리는 1번, drain을 기다리는 3번, 강제 종료하는 5번은 api와 worker가 같은 종료 조율(`ShutdownService`)로 함께 씁니다. `SHUTDOWN_DRAIN_MS`는 0 이상, `SHUTDOWN_TIMEOUT_MS`는 양수 정수이며, 각 값과 합계는 Node 타이머 상한인 2,147,483,647ms 이하로 제한합니다. 상한을 넘는 타이머는 Node가 1ms로 바꿔 실행해 기동 직후 강제 종료로 이어지므로, 환경변수 검증 단계에서 거부합니다.

### 중복과 누락을 막는 방법

| 상황 | 처리 |
| --- | --- |
| 같은 수신자 두 번 생성 | `deliveries (alarm_id, recipient_id)` unique 제약 |
| 워커 두 대가 같은 Delivery를 가져감 | `FOR UPDATE SKIP LOCKED` + lease |
| lease를 잃은 워커의 늦은 결과 | claim마다 새 `leaseToken`을 발급하고, 결과는 토큰과 상태가 일치할 때만 저장 (fencing) |
| lease가 거의 끝난 상태에서 새 요청 | 남은 lease가 HTTP 최대 실행 시간보다 짧으면 요청을 시작하지 않음. claim 커밋이 늦어질 수 있으므로 요청 직전에 한 번 더 확인 |
| 500/503 | 외부 API가 "발송되지 않음"을 보장하므로 백오프 후 재전송 |
| 응답 타임아웃 · 연결 오류 · lease 만료 | **재전송하지 않고** `UNKNOWN`으로 둔 뒤, reconcile 가능 시각(마지막 요청 시작 또는 lease 만료 + `RECONCILE_DELAY_MS`) 이후 `GET /v1/messages?clientRef=`로 확인. 내역이 있으면 `SENT`, 없으면 최대 시도 횟수 안에서 재전송 |
| 발송 내역 조회 실패 | 빈 내역으로 보지 않고 `UNKNOWN` 유지, 백오프 후 다시 조회 |
| 확인 기간이 지나도 확정 못 함 | `UNCONFIRMED`로 종결. 실제로 나갔을 수 있으므로 `FAILED`와 구분해 집계하고 운영 확인 대상으로 둠 |
| 확장 도중 워커 종료 | 페이지마다 Delivery 생성과 cursor 저장을 한 트랜잭션으로 커밋하고, 확장 작업의 lease가 만료되면 다른 워커가 저장된 cursor부터 이어서 읽음. unique 제약으로 중복 생성 방지 |
| 발송 중 워커 강제 종료 | 그 워커가 쥔 Delivery는 lease 만료 후 `UNKNOWN`으로 복구되고 발송 내역 조회로 확정(재전송 없음) |
| 발송 중 취소 | 대기 중인 Delivery를 한 번에 `CANCELLED`로 바꾸고, claim할 때도 알림 상태를 다시 확인. 이미 나간 요청은 결과대로 `SENT` |

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
| 언어 · 프레임워크 | TypeScript 7 · NestJS 12 | 모듈 · DI · 라이프사이클로 api와 worker를 같은 구조로 조립. TS7(tsgo)로 빠른 타입 검사 |
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

OpenAPI 3.0 문서는 `/docs-json`에서, 같은 문서의 Swagger UI는 `/docs`에서 제공합니다. 요청 본문 · 경로 · 쿼리 스키마는 컨트롤러에 붙인 zod 스키마에서 `@nestjs/swagger`가 OpenAPI 3.0 문법으로 만들고, e2e 테스트가 제공되는 문서를 OpenAPI 3.0 명세 검증기(`@apidevtools/swagger-parser`)로 검사합니다. 계약은 [SCENARIO.md](SCENARIO.md)의 `API-*` 시나리오로 정의되어 있습니다.

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `POST` | `/alarms` | 알림 생성 (대량 / 긴급) |
| `GET` | `/alarms` | 알림 목록 (status · kind 필터, cursor 페이지네이션) |
| `GET` | `/alarms/:id` | 알림 단건 (Delivery 상태별 집계 포함) |
| `POST` | `/alarms/:id/dispatch` | 발송 시작 |
| `POST` | `/alarms/:id/cancel` | 발송 취소 |
| `GET` | `/livez` · `/readyz` | liveness(의존성을 보지 않음) · readiness(종료 중이거나 DB에 1초 안에 쿼리할 수 없으면 503) 프로브 |

알림의 상태는 `DRAFT` → `DISPATCHING` → `COMPLETED`, 그리고 `DRAFT` · `DISPATCHING`에서 `CANCELLED`로만 바뀝니다. 응답에는 그 상태에 해당하는 시각만 들어갑니다(`dispatchedAt` · `completedAt` · `cancelledAt`).

아래 예시는 `docker compose up`으로 띄운 서버의 실제 응답입니다(id · 시각은 실행마다 다릅니다).

### 알림 생성 — `POST /alarms`

대량 알림은 전체 사용자에게, 긴급 알림은 `recipientIds`로 지정한 사용자(1~100명)에게 보냅니다. 대량 알림에는 `recipientIds`를 넣지 않습니다.

```bash
curl -X POST localhost:3000/alarms -H 'Content-Type: application/json' \
  -d '{"title":"추석 이벤트 안내","body":"추석 맞이 쿠폰이 도착했습니다","kind":"BULK"}'
```

```json
201 Created
{
  "id": "af8abf04-e0fe-4405-8828-806d87c1aef3",
  "title": "추석 이벤트 안내",
  "body": "추석 맞이 쿠폰이 도착했습니다",
  "kind": "BULK",
  "recipientIds": [],
  "createdAt": "2026-10-09T01:18:46.881Z",
  "status": "DRAFT"
}
```

```bash
curl -X POST localhost:3000/alarms -H 'Content-Type: application/json' \
  -d '{"title":"결제 인증번호","body":"인증번호는 482913 입니다","kind":"URGENT","recipientIds":["u_000001","u_000002"]}'
```

### 발송 시작 — `POST /alarms/:id/dispatch`

발송은 워커가 비동기로 처리하므로 `202 Accepted`와 `DISPATCHING` 알림을 돌려줍니다. 진행 상황은 단건 조회로 확인합니다.

```json
202 Accepted
{
  "id": "11755e9d-05c7-4b20-b697-572625c343b6",
  "title": "결제 인증번호",
  "body": "인증번호는 482913 입니다",
  "kind": "URGENT",
  "recipientIds": ["u_000001", "u_000002"],
  "createdAt": "2026-10-09T01:18:46.847Z",
  "status": "DISPATCHING",
  "dispatchedAt": "2026-10-09T01:18:46.903Z"
}
```

### 단건 조회 — `GET /alarms/:id`

알림과 수신자별 Delivery의 상태별 개수를 같은 시점의 스냅샷으로 함께 돌려줍니다.

```json
200 OK
{
  "id": "11755e9d-05c7-4b20-b697-572625c343b6",
  "title": "결제 인증번호",
  "body": "인증번호는 482913 입니다",
  "kind": "URGENT",
  "recipientIds": ["u_000001", "u_000002"],
  "createdAt": "2026-10-09T01:18:46.847Z",
  "status": "COMPLETED",
  "dispatchedAt": "2026-10-09T01:18:46.903Z",
  "completedAt": "2026-10-09T01:18:48.400Z",
  "deliveries": {
    "total": 2,
    "byStatus": {
      "PENDING": 0, "IN_FLIGHT": 0, "RETRY_WAIT": 0, "UNKNOWN": 0,
      "SENT": 2, "FAILED": 0, "UNCONFIRMED": 0, "CANCELLED": 0
    }
  }
}
```

### 목록 조회 — `GET /alarms`

| 쿼리 | 값 | 기본값 |
| --- | --- | --- |
| `status` | `DRAFT` · `DISPATCHING` · `COMPLETED` · `CANCELLED` | 전체 |
| `kind` | `BULK` · `URGENT` | 전체 |
| `limit` | 1~100 | 20 |
| `cursor` | 이전 응답의 `page.nextCursor` | 최신부터 |

생성 역순으로 돌려주고, 다음 페이지가 있을 때만 `page.nextCursor`가 있습니다. cursor는 마지막 항목의 `(createdAt, id)`라서 페이지를 넘기는 사이에 새 알림이 생겨도 같은 항목이 두 번 나오지 않고, 이미 받은 페이지가 밀려 항목을 건너뛰지도 않습니다. 다만 페이지마다 그 시점의 데이터를 읽으므로 페이지 사이의 스냅샷은 같지 않습니다. `status`로 거르는 중에 이미 지나간 위치의 알림 상태가 바뀌면, 그 알림은 다음 페이지에 나오지 않습니다.

```json
200 OK   GET /alarms?limit=1
{
  "items": [{ "id": "af8abf04-…", "title": "추석 이벤트 안내", "kind": "BULK", "status": "CANCELLED", "…": "…" }],
  "page": { "nextCursor": "MjAyNi0xMC0wOVQwMToxODo0Ni44ODFafGFmOGFiZjA0LWUwZmUtNDQwNS04ODI4LTgwNmQ4N2MxYWVmMw" }
}
```

### 발송 취소 — `POST /alarms/:id/cancel`

`DRAFT` · `DISPATCHING` 알림을 취소합니다. 아직 보내지 않은 Delivery는 `CANCELLED`가 되고, 이미 보낸 요청의 결과는 그대로 기록됩니다.

```json
200 OK
{
  "id": "af8abf04-e0fe-4405-8828-806d87c1aef3",
  "title": "추석 이벤트 안내",
  "body": "추석 맞이 쿠폰이 도착했습니다",
  "kind": "BULK",
  "recipientIds": [],
  "createdAt": "2026-10-09T01:18:46.881Z",
  "status": "CANCELLED",
  "dispatchedAt": "2026-10-09T01:18:49.961Z",
  "cancelledAt": "2026-10-09T01:18:52.027Z"
}
```

### 에러 응답

에러는 RFC 9457 Problem Details(`application/problem+json`)로 응답하고, 원인을 `code`로, 필드별 검증 오류를 `errors[]`로 줍니다. 예외는 `/livez` · `/readyz`로, k8s 프로브가 기대하는 terminus 형식을 그대로 유지합니다.

| 상태 | `code` | 상황 |
| --- | --- | --- |
| 400 | `VALIDATION_FAILED` | 본문 · 경로 · 쿼리 값이 형식에 맞지 않거나 도메인 규칙(제목 비어 있음, 긴급 수신자 1~100명 등)을 어김 |
| 404 | `ALARM_NOT_FOUND` | 없는 알림 |
| 409 | `ALARM_STATE_CONFLICT` | 현재 상태에서 할 수 없는 전이(예: 완료된 알림 취소, 발송 중인 알림 다시 발송) |

```json
400 Bad Request
{
  "type": "about:blank",
  "title": "Bad Request",
  "status": 400,
  "detail": "요청 값이 올바르지 않습니다",
  "instance": "/alarms",
  "code": "VALIDATION_FAILED",
  "errors": [{ "field": "title", "message": "제목이 비어 있습니다" }]
}
```

```json
409 Conflict
{
  "type": "about:blank",
  "title": "Conflict",
  "status": 409,
  "detail": "COMPLETED 상태의 알림은 취소할 수 없습니다",
  "instance": "/alarms/11755e9d-05c7-4b20-b697-572625c343b6/cancel",
  "code": "ALARM_STATE_CONFLICT",
  "errors": []
}
```

## 구현 코멘트

### 명세를 이렇게 해석했습니다

| 명세 | 해석 |
| --- | --- |
| 대량 알림의 수신자는 "전체 사용자" | 발송을 시작한 뒤 mock 사용자 API를 끝까지 읽은 시점의 사용자로 정합니다. 읽는 도중 추가된 사용자는 포함될 수도 있고, 확장이 끝난 뒤 바뀐 목록은 반영하지 않습니다. |
| 긴급 알림은 대량 알림보다 "먼저 처리" | 발송 가능한 긴급 Delivery가 있는 동안, 처리량 허가를 얻은 요청은 긴급 Delivery를 보냅니다. 이미 나간 대량 요청은 되돌릴 수 없으므로 예외이고, 재시도 대기 중인 긴급 건은 대량 발송을 막지 않습니다. |
| 긴급 알림 수신자 "최대 100명" | 1~100명으로 받습니다. 수신자 없는 긴급 알림은 거부합니다. |
| 중복 · 누락이 없어야 함 | 외부 API에 멱등 키가 없어 exactly-once는 보장할 수 없습니다. 응답을 받지 못한 건은 재전송하지 않고 발송 내역 조회로 확정하는 것으로 중복을, lease 만료 복구로 누락을 막습니다. 남는 한계는 [중복과 누락을 막는 방법](#중복과-누락을-막는-방법)에 적었습니다. |
| `429`가 "지속적으로" 발생하면 안 됨 | 정상 상황에서는 429가 나지 않게 하는 것을 목표로 했습니다(e2e에서 워커 2·3대 모두 0건). 그래도 429를 받으면 `Retry-After`만큼 모든 워커가 함께 멈춥니다. |
| 발송 중 취소 | 아직 보내지 않은 Delivery만 취소합니다. 이미 나간 요청은 결과대로 `SENT`(또는 `FAILED`)로 남깁니다. |
| 알림 "완료" | 확장이 끝났고 미종결 Delivery가 없을 때입니다. 확인 기간이 지나도 결과를 알 수 없는 `UNCONFIRMED`는 종결로 셉니다. |

### API 설계

- 알림 하나를 리소스로 두고, 상태를 바꾸는 동작(발송 시작 · 취소)은 `POST /alarms/:id/dispatch` · `/cancel`로 나눴습니다. `PATCH { status }`로 상태를 직접 쓰게 하면 허용되지 않는 전이를 클라이언트가 고를 수 있기 때문입니다.
- 발송 시작은 실제 발송을 기다리지 않으므로 `202 Accepted`를 돌려주고, 진행 상황은 단건 조회의 Delivery 상태별 개수로 봅니다.
- 목록은 offset 대신 `(createdAt, id)` cursor로 페이지를 나눕니다. 발송 중에도 알림이 계속 생기고 상태가 바뀌므로, offset이면 앞에 새 알림이 끼어들 때 같은 항목이 두 번 나오거나 건너뜁니다. 다만 페이지 사이의 스냅샷을 보장하지는 않습니다([목록 조회](#목록-조회--get-alarms)).
- 에러는 RFC 9457 형식 하나로 통일하고, 클라이언트가 분기할 수 있도록 `code`와 필드별 `errors[]`를 붙였습니다.

### 데이터 처리와 성능

- 대량 알림 10만 건은 발송 시작 요청에서 만들지 않습니다. 요청은 알림 상태와 확장 작업만 한 트랜잭션에 저장하고 바로 응답하며, 워커가 사용자 1,000명 단위 페이지로 Delivery를 만듭니다. 페이지마다 Delivery 생성과 cursor 저장을 함께 커밋하므로, 확장 도중 워커가 죽어도 다른 워커가 이어받습니다.
- 발송 대기열은 `deliveries` 테이블 자체입니다. claim · reconcile · lease 복구는 상태별 부분 인덱스를 쓰므로 종결된 행이 쌓여도 대기열 조회 비용이 커지지 않습니다.
- 처리량은 한도 준수를 우선했습니다. 허가 간격을 20ms로 고르게 나누는 GCRA는 늦게 나간 허가를 만회하지 않아 한도보다 조금 낮은 속도가 나옵니다. `docker compose up --scale worker=3`에 mock 기본값(일시 오류 5%, 3초 이상 지연 5%, 30초 타임아웃 2%)으로 10만 명 알림을 보내 보니 429는 0건이었고, 처음 20초 동안 약 29건/초를 보냈습니다. 그 사이 확장도 함께 진행됐고, 느린 응답과 타임아웃이 동시 발송 슬롯을 붙잡는 영향이 커 보입니다(측정으로 원인을 나누지는 않았습니다).
- 알림 완료 판정은 결과가 확정될 때마다가 아니라 주기적으로 합니다([상태 모델](#상태-모델)). 수신자 10만 명이면 결과마다 미종결 건수를 세는 쿼리가 10만 번 돌기 때문입니다.

### 고민한 지점과 되돌린 결정

- **메시지 브로커를 두지 않았습니다.** Redis나 큐를 따로 두면 "알림 상태 변경"과 "작업 등록"이 서로 다른 저장소에 쓰이는 이중 쓰기 문제가 생깁니다. PostgreSQL 하나로 상태와 작업 큐를 한 트랜잭션에 두고, `SKIP LOCKED` · lease · 공유 제한기 행으로 다중 워커 문제를 풀었습니다.
- **claim한 채 허가를 기다리지 않습니다.** Delivery를 먼저 잡아 두고 처리량 허가를 기다리는 흐름이 더 단순하지만, 그러면 기다리는 동안 생긴 긴급 건이 이미 잡힌 대량 건 뒤로 밀립니다. 그래서 허가를 먼저 얻고, 그 순간 가장 급한 1건을 잡아 바로 보냅니다. 대가로 허가를 얻었는데 보낼 건이 없으면 그 허가는 버려집니다(한도를 넘지는 않습니다).
- **마이그레이션을 앱 기동에서 분리했습니다.** 기동 시 마이그레이션하면 api · worker 여러 개가 동시에 실행하는데, Drizzle의 `migrate()`는 잠금을 잡지 않습니다. 일회성 `migrate` 서비스가 끝난 뒤 api · worker가 뜨게 했습니다.
- **워커 루프 정지 시점을 옮겼습니다.** 처음에는 drain과 같은 종료 단계(`beforeApplicationShutdown`)에서 루프를 멈췄습니다. 그런데 같은 단계 안의 순서는 모듈 깊이와 등록 순서에 따라 정해져서, 지금의 import 구성에서는 drain이 먼저 실행되어 5초 동안 새 claim이 계속될 수 있었습니다. 실제와 같은 모듈 구성으로 테스트를 만들어 재현한 뒤, 루프 정지를 앞 단계(`onModuleDestroy`)로 옮겼습니다.
- **발송 직전에 lease를 다시 확인합니다.** claim과 요청 시작 기록은 같은 트랜잭션이지만 커밋이 늦어지면 lease가 거의 남지 않은 채 요청을 보낼 수 있어, 요청 직전에 한 번 더 확인하고 부족하면 보내지 않게 했습니다(그 건은 lease 만료 후 복구 · 조회로 확정).
- **완료 확인을 한 번에 한 페이지로 줄였습니다.** 처음에는 발송 중인 알림 전체를 한 번에 훑었는데, 알림이 많으면 종료할 때 그 순회가 끝날 때까지 기다려야 했습니다. 실행 한 번에 100개만 확인하고 다음 위치를 이어가게 했습니다.
- **시각 기준을 문서에서 바로잡았습니다.** 처음에는 claim · 복구도 DB 시계로 판정하겠다고 적었지만, 실제로는 제한기만 DB 시계가 필요했습니다. 판정 단위가 30초 이상인 나머지는 워커 시계로 충분하고, 시계가 크게 어긋나도 leaseToken fencing이 늦은 결과를 막는다는 근거와 함께 구현대로 문서를 고쳤습니다.
- **OpenAPI는 3.0으로 냈습니다.** 요구사항이 "OpenAPI 3.0 스펙"이라, 3.1 대신 `@nestjs/swagger`가 만드는 3.0 문서를 그대로 제공하고 e2e에서 3.0 명세 검증기로 검사합니다.

### 테스트로 보장을 확인한 방법

- 시나리오를 먼저 [SCENARIO.md](SCENARIO.md)에 ID로 정하고, ID를 이름에 단 테스트로 하나씩 바꿨습니다.
- 동시성 · 장애 보장은 e2e에서 실제 worker 프로세스(1~3대)와 실제 mock 컨테이너로 확인합니다. "정확히 1번 보냈다"는 DB가 아니라 mock의 발송 내역으로 Delivery마다 셉니다.
- 테스트가 정말 그 보장을 검증하는지, 구현을 일부러 망가뜨려(변이) 실패하는지 확인했습니다. 완료 루프 · reconcile 루프 · lease 복구 루프 제거, 우선순위 정렬 반전, 처리량 제한기 해제, 취소 방어선 제거에서 각각 해당 e2e가 실패합니다. 이 과정에서 테스트의 빈틈을 여러 번 찾았습니다. 예를 들어 긴급 우선 판정을 "첫 긴급 발송과 마지막 긴급 발송 사이에 대량 발송이 없다"로 했더니, 우선순위를 뒤집으면 긴급이 맨 끝에 몰려 오히려 통과했습니다. 지금은 "긴급 발송을 시작한 시점에 이미 시작된 대량 건 + 동시 발송 수"를 넘는 대량 발송이 마지막 긴급 발송보다 먼저 나가지 않았는지로 판정합니다.
- 단언을 더하다가 기존 판정이 아무것도 검증하지 못하던 것을 발견하기도 했습니다. 발송 중 취소 e2e는 "최종 `SENT` 수 ≤ 취소 시점에 시작된 건 수"로 새 발송이 멈췄는지 봤는데, 취소 직후에는 대기 건이 이미 `CANCELLED`로 바뀌어 있어 "`PENDING`이 아닌 건"을 세면 항상 전체 건수가 나왔습니다. 취소 시점에 남은 대기 건이 실제로 있는지 확인하는 단언을 더하자 실패했고, 집계에서 `CANCELLED`를 빼서 고쳤습니다.
- 테스트의 시각 비교는 한 시계 안에서만 합니다. 긴급 우선 판정은 mock 발송 시각끼리 비교하고, 기준 시점은 DB의 상태 개수로 잡아 테스트 프로세스와 컨테이너의 시계 차이에 영향받지 않게 했습니다.

### 시간이 더 있다면

- **Delivery 시도 이력 테이블:** 상태 전이마다 한 행을 추가하는 append-only 테이블을 두어, 한 건이 어떤 시도와 응답을 거쳐 종결됐는지 남기겠습니다. 지금은 현재 상태와 종결 결과만 남습니다.
- **처리량 개선:** 제한기가 거절할 때 다음 허가까지의 대기 시간을 돌려주게 해서 폴링 간격 대신 정확히 기다리고, 워커당 동시 발송 수를 측정으로 정하겠습니다. 부하 측정(k6)으로 대량 발송 중 조회 응답 시간도 확인하고 싶습니다.
- **완료 확인 중복 줄이기:** 지금은 모든 워커가 같은 알림을 주기적으로 확인합니다(결과는 멱등). 워커가 많아지면 advisory lock으로 한 워커만 확인하게 하겠습니다.
- **사후 감사:** 알림이 끝난 뒤 `UNKNOWN`을 거친 건만 발송 내역을 다시 조회해, `SENT`로 확정된 뒤 생긴 중복을 찾는 작업입니다.
- **OpenAPI 응답 스키마:** 요청 스키마는 zod에서 문서로 만들지만, 응답 본문 스키마는 아직 설명 위주입니다. 응답도 스키마로 정의해 문서와 e2e 검증에 함께 쓰겠습니다.
