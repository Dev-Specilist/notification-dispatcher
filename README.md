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

## 레이어 구조

```
┌─ presentation ─────────────────────┐      ┌─ infrastructure ───────────────────┐
│ controllers · request schemas      │      │ drizzle repositories               │
│ Problem Details · OpenAPI          │      │ postgres rate limiter              │
│                                    │      │ mock API http adapters             │
│                                    │      │ worker loops (Nest lifecycle)      │
└─────────────────┬──────────────────┘      └─────────────────┬──────────────────┘
                  │ calls use cases                           │ implements ports
                  ▼                                           ▼
┌─ application ──────────────────────────────────────────────────────────────────┐
│ use cases : CreateAlarm · StartDispatch · CancelAlarm · GetAlarm · ListAlarms  │
│             ExpandRecipients · SendDeliveries · ReconcileDeliveries            │
│             CompleteAlarmIfSettled                                             │
│ ports     : AlarmRepository · DeliveryRepository · RecipientDirectory          │
│             MessageSender (+ SendOutcome union) · RateLimiter · UnitOfWork     │
│             Clock                                                              │
└──────────────────────────────────────┬─────────────────────────────────────────┘
                                       │ uses
                                       ▼
┌─ domain ───────────────────────────────────────────────────────────────────────┐
│ Alarm (aggregate) · Delivery (aggregate) · state transitions · RetryPolicy     │
│ no Nest, no DB, no HTTP, no zod                                                │
└────────────────────────────────────────────────────────────────────────────────┘
```

- 의존성은 바깥에서 안쪽으로만 향합니다. domain은 아무것도 모르고, application은 port(abstract class)만 알고, infrastructure가 port를 구현합니다.
- port를 abstract class로 정의해서 그 자체를 Nest DI 토큰으로 씁니다(`{ provide: AlarmRepository, useClass: DrizzleAlarmRepository }`).
- 성공과 실패는 예외 대신 `kind`로 구분하는 discriminated union으로 표현합니다. 외부 발송 결과(`SendOutcome = Accepted | PermanentFailure | TransientFailure | RateLimited | Unknown`)는 발송 port의 계약이므로 application의 port 옆에 둡니다.

## 파일 구조

```
📦 notification-dispatcher
├── 📂 src/
│   ├── 📄 main.ts                                   api 엔트리포인트
│   ├── 📄 worker.ts                                 worker 엔트리포인트
│   ├── 📂 bootstrap/                                composition root
│   │   ├── 📄 api.module.ts
│   │   ├── 📄 worker.module.ts
│   │   ├── 📂 lifecycle/
│   │   │   ├── 📄 lifecycle.module.ts
│   │   │   └── 📄 shutdown.service.ts               신호 즉시 readiness down · drain · watchdog
│   │   └── 📂 server/
│   │       ├── 📄 server.bootstrap.ts               기동 · 기동 실패 처리 · 종료 hook(exit 0)
│   │       ├── 📄 listen-address.type.ts
│   │       └── 📄 listen-address.util.ts            Local/Network 주소 로그
│   ├── 📂 modules/
│   │   ├── 📂 health/                               /livez · /readyz · readiness 상태
│   │   │   ├── 📂 application/port/readiness.port.ts
│   │   │   ├── 📂 infrastructure/
│   │   │   │   ├── 📄 adapter/in-memory-readiness.adapter.ts
│   │   │   │   └── 📄 readiness.health-indicator.ts
│   │   │   ├── 📂 presentation/
│   │   │   │   ├── 📄 health.controller.ts
│   │   │   │   └── 📄 health-check.filter.ts
│   │   │   └── 📄 health.module.ts
│   │   └── 📂 notification/                         알림 bounded context
│   │       ├── 📂 domain/
│   │       │   ├── 📂 alarm/
│   │       │   │   ├── 📄 alarm.entity.ts           상태 전이 · 불변식
│   │       │   │   ├── 📄 alarm.type.ts             AlarmId · AlarmStatus · AlarmKind
│   │       │   │   └── 📄 alarm.error.ts
│   │       │   └── 📂 delivery/
│   │       │       ├── 📄 delivery.entity.ts        상태 전이 · lease
│   │       │       ├── 📄 delivery.type.ts          DeliveryId · DeliveryStatus
│   │       │       └── 📄 retry-policy.ts           지수 백오프 + jitter
│   │       ├── 📂 application/
│   │       │   ├── 📂 port/                         *.port.ts (abstract class) · send-outcome.type.ts
│   │       │   └── 📂 use-case/                     *.use-case.ts · *.query.ts
│   │       ├── 📂 infrastructure/
│   │       │   ├── 📂 adapter/                      drizzle-* · postgres-rate-limiter · mock-*
│   │       │   ├── 📂 persistence/                  drizzle 테이블 정의
│   │       │   └── 📂 worker/                       expansion · dispatch · reconcile loop
│   │       ├── 📂 presentation/                     alarm.controller.ts · alarm.schema.ts
│   │       ├── 📄 notification-api.module.ts
│   │       └── 📄 notification-worker.module.ts
│   └── 📂 shared/
│       ├── 📂 config/                               zod env 스키마 · brand 타입 · TypedConfigService
│       ├── 📂 http/                                 RFC 9457 Problem Details · 요청 검증
│       ├── 📂 logging/                              Nest ConsoleLogger 기반 AppLogger
│       └── 📂 database/                             Drizzle 연결 · UnitOfWork
├── 📂 drizzle/                                      마이그레이션 SQL
├── 📂 test/                                         e2e (api 전체 · 발송 전체 흐름)
├── 📄 Dockerfile                                    target: api · worker
├── 📄 docker-compose.yml                            api · worker · postgres · mock
├── 📄 vitest.config.mts                             unit · integration · characterization · e2e 프로젝트
├── 📄 SCENARIO.md                                   테스트 시나리오 (ID ↔ 테스트 이름)
└── 📄 README.md
```

테스트는 구현 파일 옆에 둡니다.

| 종류 | 파일 | 실행 | 대상 | 컨테이너 |
| --- | --- | --- | --- | --- |
| unit | `*.spec.ts` | `pnpm test` | domain · use case (port는 in-memory fake) | 없음 |
| integration | `*.int-spec.ts` | `pnpm test:int` | adapter (Drizzle 저장소, 제한기, mock API adapter) | PostgreSQL · mock (Testcontainers) |
| characterization | `*.characterization.int-spec.ts` | `pnpm test:int` (integration 다음에 단독 실행) | mock 한도·발송 기록 시점, 제한기를 거친 처리량 | PostgreSQL · mock (Testcontainers) |
| e2e | `test/*.e2e-spec.ts` | `pnpm test:e2e` | HTTP 계약과 api + worker 전체 흐름 | PostgreSQL · mock (Testcontainers) |

- 컨테이너는 vitest `globalSetup`에서 실행 단위마다 한 번만 띄우고, 테스트 파일마다 별도 database를 써서 서로 섞이지 않게 합니다. mock은 `RATE_LIMIT` · `ERROR_RATE` · `TIMEOUT_RATE` 설정별로 따로 띄웁니다.
- 저장소 port의 계약 테스트 하나를 in-memory fake와 Drizzle adapter 양쪽에 돌려서, unit 테스트의 fake가 실제 구현과 같은 계약을 지킨다는 것을 보장합니다.
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
