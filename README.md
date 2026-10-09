# notification-dispatcher

다수의 수신자에게 알림을 보내는 NestJS 백엔드입니다. API 서버(`api`)가 알림을 만들고 발송을 시작·취소하며, 발송 워커(`worker`)가 별도 컨테이너에서 수신자별 발송 건을 처리합니다. 외부 발송 서비스로는 과제에서 제공한 mock 서버를 씁니다.

| 용어 | 뜻 |
| --- | --- |
| 알림(`Alarm`) | 제목 · 본문 · 종류 · 상태를 가진 발송 단위. 대량 알림(`BULK`)은 전체 사용자에게, 긴급 알림(`URGENT`)은 지정한 1~100명에게 보냅니다 |
| 발송 건(`Delivery`) | 알림 하나를 수신자 한 명에게 보내는 작업. id를 외부 API의 `clientRef`로 씁니다 |
| 수신자 확장 | 대량 알림의 수신자를 mock 사용자 API에서 페이지 단위로 읽어 발송 건으로 만드는 단계 |
| 발송 허가 | 모든 워커가 함께 쓰는 처리량 제한기에서 얻는 1건분의 발송 권한 |
| lease · fencing | 워커가 발송 건을 처리하는 동안 갖는 임시 소유권(만료 시각 + `leaseToken`), 그리고 토큰이 일치할 때만 결과를 저장하게 하는 장치 |
| 결과 불명(`UNKNOWN`) · reconcile | 요청은 보냈지만 응답을 받지 못한 상태, 그리고 발송 내역 조회(`GET /v1/messages?clientRef=`)로 그 결과를 확정하는 단계 |

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

- `api` · `worker` · `migrate`는 같은 Dockerfile의 다른 target으로 빌드한 이미지입니다. `migrate`는 스키마를 적용하고 끝나는 일회성 컨테이너입니다.
- 메시지 브로커 없이 `deliveries` 테이블이 작업 큐입니다. 알림 상태 변경과 작업 생성이 한 트랜잭션에 들어갑니다.
- 워커는 몇 대로 늘려도 `FOR UPDATE SKIP LOCKED`로 서로 다른 발송 건을 가져가고, 처리량은 PostgreSQL의 제한기 행 하나를 함께 씁니다.

## 실행 방법

### Docker Compose

```bash
docker compose up --build
```

```bash
docker compose up --build --scale worker=3
```

- 기동 순서는 `postgres` healthy → 일회성 `migrate` 성공 → `api` · `worker`입니다. `worker`는 `mock`이 healthy가 될 때까지도 기다립니다.
- 호스트에는 `api`의 3000번 포트만 공개합니다. PostgreSQL과 mock은 compose 내부 네트워크에서만 접근합니다.
- API 문서는 http://localhost:3000/docs (Swagger UI)와 http://localhost:3000/docs-json (OpenAPI 3.0)에 있습니다.
- 데이터는 이름 있는 볼륨(`postgres_data`)에 남습니다. 처음 상태로 되돌리려면 `docker compose down -v`를 씁니다.

### 로컬 개발

도구 버전(node 24.21.0, pnpm 10.34.5)은 `mise.toml`에 고정되어 있습니다.

```bash
mise install && pnpm install
```

compose는 PostgreSQL과 mock의 포트를 호스트에 공개하지 않으므로, 로컬 개발용으로 따로 띄웁니다.

```bash
docker run -d --name notification-postgres -p 5432:5432 \
  -e POSTGRES_USER=notification -e POSTGRES_PASSWORD=notification -e POSTGRES_DB=notification \
  postgres:18-alpine
docker run -d --name notification-mock -p 4000:4000 ghcr.io/us-all/backend-assignment-api:1.2
```

env는 기동할 때 zod로 검증합니다. 필수값은 `DATABASE_URL` 하나이고, `.env` 파일은 읽지 않으므로 셸에서 지정합니다. 스키마는 별도의 일회성 프로세스(`pnpm db:migrate`)로 적용합니다.

```bash
export DATABASE_URL=postgres://notification:notification@localhost:5432/notification
pnpm db:migrate
pnpm dev
```

`pnpm dev`는 한 번 빌드한 뒤 SWC watch 하나가 `dist/`를 갱신하고, api와 worker가 변경을 감지해 재시작합니다. 하나만 띄울 때는 `pnpm dev:api` 또는 `pnpm dev:worker`를 씁니다(각자 `dist/`를 다시 빌드하므로 둘을 동시에 띄우지 않습니다).

### 테스트

```bash
pnpm typecheck && pnpm lint
pnpm test && pnpm test:int && pnpm test:e2e
```

integration과 e2e는 Testcontainers로 실제 PostgreSQL과 mock 컨테이너를 띄우므로 Docker가 실행 중이어야 합니다.

| 종류 | 파일 | 실행 | 대상 |
| --- | --- | --- | --- |
| unit | `*.spec.ts` | `pnpm test` | domain, 유스케이스(port는 in-memory fake), 워커 루프 |
| integration | `*.int-spec.ts` | `pnpm test:int` | Drizzle 저장소 · 처리량 제한기 · mock API adapter · 마이그레이션 |
| characterization | `*.characterization.int-spec.ts` | `pnpm test:int` (integration 다음에 단독 실행) | mock의 한도 방식 · 발송 기록 시점, 제한기를 거친 처리량 |
| e2e | `test/*.e2e-spec.ts` | `pnpm test:e2e` | HTTP 계약 · OpenAPI 문서, 실제 worker 프로세스(1~3대)로 발송 전체 흐름 · 강제 종료 · 취소 · SIGTERM |

- 시나리오는 [SCENARIO.md](SCENARIO.md)에 ID로 정의하고, 테스트 이름 앞에 같은 ID를 붙여 연결합니다.
- PostgreSQL은 실행 단위마다 한 번 띄워 마이그레이션한 템플릿 DB를 만들고, 테스트 파일마다 복제한 별도 database를 씁니다. mock은 테스트마다 시나리오에 맞는 설정(`USER_COUNT` · `ERROR_RATE` · `TIMEOUT_RATE` 등)으로 띄웁니다.
- 저장소 계약 테스트(`testing/contract/`) 하나를 in-memory fake와 Drizzle adapter 양쪽에 돌려, unit 테스트의 fake가 실제 구현과 같은 계약을 지키게 합니다.

### 주요 환경 변수

| 변수 | 기본값 | 의미 |
| --- | --- | --- |
| `DATABASE_URL` | (필수) | PostgreSQL 접속 주소 |
| `DATABASE_POOL_MAX` | 20 | 프로세스당 PostgreSQL 연결 수 상한 |
| `MOCK_API_URL` | `http://localhost:4000` | 외부 발송 API 주소 |
| `DISPATCH_CONCURRENCY` | 8 | 워커 프로세스당 동시 발송 루프 수 |
| `DISPATCH_MAX_REQUEST_MS` | 5000 | 외부 API 요청 타임아웃 |
| `DISPATCH_LEASE_MS` | 30000 | 발송 건 · 확장 작업 lease. 요청 타임아웃보다 길어야 기동됩니다 |
| `RECONCILE_DELAY_MS` | 35000 | 결과 불명 건을 조회하기 전에 기다리는 시간 |
| `UNCONFIRMED_AFTER_MS` | 3600000 | 이 기간 안에 결과를 확정하지 못하면 `UNCONFIRMED`로 종결 |
| `RETRY_MAX_ATTEMPTS` · `RETRY_BASE_DELAY_MS` · `RETRY_MAX_DELAY_MS` | 5 · 1000 · 60000 | 500/503 재시도 횟수와 백오프 |
| `LOOKUP_RETRY_BASE_DELAY_MS` · `LOOKUP_RETRY_MAX_DELAY_MS` | 5000 · 60000 | 발송 내역 조회 실패 시 백오프 |
| `RATE_LIMIT_INTERVAL_MS` | 20 | 발송 허가 간격. 20 미만(초당 50건 초과)이면 기동을 거부합니다 |
| `USER_PAGE_LIMIT` | 1000 | 수신자 확장 페이지 크기(1~1000) |
| `WORKER_POLL_INTERVAL_MS` · `WORKER_ERROR_DELAY_MS` · `COMPLETION_CHECK_INTERVAL_MS` | 100 · 1000 · 1000 | 할 일이 없을 때 · 오류 후 · 완료 확인 한 바퀴 후 대기 시간 |
| `SHUTDOWN_DRAIN_MS` · `SHUTDOWN_TIMEOUT_MS` | 5000 · 25000 | 종료 시 drain 시간과 제한 시간 |
| `HOST` · `PORT` · `LOG_LEVEL` · `LOG_FORMAT` | `0.0.0.0` · api 3000, worker 3001 · `log` · `pretty` | compose는 `LOG_FORMAT=json`으로 띄웁니다 |

## API

OpenAPI 3.0 문서는 `/docs-json`, Swagger UI는 `/docs`에서 제공합니다. 요청(본문 · 경로 · 쿼리) 스키마는 컨트롤러의 zod 스키마에서 만들어지고, 성공 응답과 오류 응답(`application/problem+json`)도 스키마로 문서에 들어갑니다. e2e가 제공되는 문서를 OpenAPI 3.0 명세 검증기(`@apidevtools/swagger-parser`)로 검사하고, 각 엔드포인트의 응답 스키마가 실제 응답과 맞는지 확인합니다.

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `POST` | `/alarms` | 알림 생성 (대량 / 긴급) |
| `GET` | `/alarms` | 알림 목록 (`status` · `kind` 필터, cursor 페이지네이션) |
| `GET` | `/alarms/:id` | 알림 단건 (발송 건 상태별 개수 포함) |
| `POST` | `/alarms/:id/dispatch` | 발송 시작 |
| `POST` | `/alarms/:id/cancel` | 발송 취소 |
| `GET` | `/livez` · `/readyz` | liveness(의존성을 보지 않음) · readiness(종료 중이거나 DB가 1초 안에 응답하지 않으면 503). api와 worker 모두 제공 |

알림 상태는 `DRAFT` → `DISPATCHING` → `COMPLETED`, 그리고 `DRAFT` · `DISPATCHING`에서 `CANCELLED`로만 바뀝니다. 응답에는 그 상태에 해당하는 시각만 들어갑니다(`dispatchedAt` · `completedAt` · `cancelledAt`). 아래 예시는 `docker compose up`으로 띄운 서버의 실제 응답입니다(id · 시각은 실행마다 다릅니다).

### 알림 생성 — `POST /alarms` → `201 Created`

대량 알림은 전체 사용자에게 보내므로 `recipientIds`를 받지 않고, 긴급 알림은 `recipientIds`(1~100명)가 필요합니다.

```bash
curl -X POST localhost:3000/alarms -H 'Content-Type: application/json' \
  -d '{"title":"추석 이벤트 안내","body":"추석 맞이 쿠폰이 도착했습니다","kind":"BULK"}'
```

```json
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

### 발송 시작 — `POST /alarms/:id/dispatch` → `202 Accepted`

발송은 워커가 비동기로 처리하므로 `DISPATCHING` 알림을 바로 돌려줍니다. 진행 상황은 단건 조회로 확인합니다.

```json
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

### 단건 조회 — `GET /alarms/:id` → `200 OK`

알림과 발송 건의 상태별 개수를 같은 시점의 스냅샷으로 함께 돌려줍니다.

```json
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

### 목록 조회 — `GET /alarms` → `200 OK`

| 쿼리 | 값 | 기본값 |
| --- | --- | --- |
| `status` | `DRAFT` · `DISPATCHING` · `COMPLETED` · `CANCELLED` | 전체 |
| `kind` | `BULK` · `URGENT` | 전체 |
| `limit` | 1~100 | 20 |
| `cursor` | 이전 응답의 `page.nextCursor` | 최신부터 |

생성 역순으로 돌려주고, 다음 페이지가 있을 때만 `page.nextCursor`가 있습니다. 각 항목은 생성 · 발송 시작 응답과 같은 알림 모양입니다.

```json
GET /alarms?limit=1
{
  "alarms": [{ "id": "af8abf04-…", "title": "추석 이벤트 안내", "kind": "BULK", "status": "CANCELLED", "…": "…" }],
  "page": { "nextCursor": "MjAyNi0xMC0wOVQwMToxODo0Ni44ODFafGFmOGFiZjA0LWUwZmUtNDQwNS04ODI4LTgwNmQ4N2MxYWVmMw" }
}
```

### 발송 취소 — `POST /alarms/:id/cancel` → `200 OK`

`DRAFT` · `DISPATCHING` 알림을 취소합니다. 아직 보내지 않은 발송 건은 `CANCELLED`가 되고, 이미 보낸 요청의 결과는 그대로 기록됩니다. 발송 중에 취소하면 `dispatchedAt`도 함께 남습니다.

```json
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

### 오류 응답

오류는 RFC 9457 Problem Details(`application/problem+json`)로 응답하고, 원인을 `code`로, 필드별 검증 오류를 `errors[]`로 줍니다. `/livez` · `/readyz`만 k8s 프로브가 기대하는 terminus 형식을 유지합니다.

| 상태 | `code` | 상황 |
| --- | --- | --- |
| 400 | `VALIDATION_FAILED` | 본문 · 경로 · 쿼리 값이 형식에 맞지 않거나 도메인 규칙(제목 비어 있음, 긴급 수신자 1~100명 등)을 어김 |
| 404 | `ALARM_NOT_FOUND` | 없는 알림 |
| 409 | `ALARM_STATE_CONFLICT` | 현재 상태에서 할 수 없는 전이(예: 완료된 알림 취소, 발송 중인 알림 다시 발송) |
| 500 | `INTERNAL_SERVER_ERROR` | 예상하지 못한 오류. 내부 정보는 응답에 담지 않고 로그에만 남김 |

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

각 결정은 **왜**(어떤 요구나 문제 때문인지), **검토한 대안**, **감수한 대가**를 함께 적습니다.

### 명세 해석

| 명세 | 해석 |
| --- | --- |
| 대량 알림의 수신자는 "전체 사용자" | 발송을 시작한 뒤 사용자 API를 끝까지 읽은 시점의 사용자로 정합니다. 읽는 도중 추가된 사용자는 포함될 수도 있고, 수신자 확장이 끝난 뒤 바뀐 목록은 반영하지 않습니다. 대량 알림에 `recipientIds`를 넣으면 거부합니다. |
| 긴급 알림은 대량 알림보다 "먼저 처리" | 발송 가능한 긴급 발송 건이 있는 동안, 발송 허가를 얻은 요청은 긴급 건을 보냅니다. 이미 나간 대량 요청은 되돌릴 수 없으므로 예외이고, 재시도 대기 중인 긴급 건은 대량 발송을 막지 않습니다. |
| 긴급 알림 수신자 "최대 100명" | 중복을 제거한 1~100명으로 받습니다. 수신자 없는 긴급 알림은 거부합니다. |
| 데이터 모델 예시의 `alarms` | 목록 응답의 키를 예시와 같은 `alarms`로 맞췄습니다. |
| 중복 · 누락이 없어야 함 | 외부 API에 멱등 키가 없어 exactly-once는 보장할 수 없습니다. 결과 불명 건은 재전송 대신 발송 내역 조회로 확정해 중복을, lease 만료 복구로 누락을 막습니다. 남는 한계는 [중복과 누락을 막는 방법](#중복과-누락을-막는-방법)에 적었습니다. |
| `429`가 "지속적으로" 발생하면 안 됨 | 정상 상황에서는 429가 나지 않게 하는 것을 목표로 했습니다(e2e에서 워커 2 · 3대 모두 0건). 그래도 429를 받으면 `Retry-After`만큼 모든 워커가 함께 멈춥니다. |
| 발송 중 취소 | 아직 보내지 않은 발송 건만 취소합니다. 이미 나간 요청은 결과대로 `SENT`(또는 `FAILED`)로 남깁니다. |
| 알림 "완료" | 수신자 확장이 끝났고 미종결 발송 건이 없을 때입니다. 끝내 결과를 확인하지 못한 `UNCONFIRMED`는 종결로 셉니다. |
| 운영 배포 가정 | 프로브(`/livez` · `/readyz`), 종료 신호 뒤의 정상 종료, 기동 시 설정 검증, JSON 로그, 외부 노출 최소화(api 포트만 공개)를 넣었습니다. |

### API 설계

| 결정 | 왜 | 검토한 대안 | 감수한 대가 |
| --- | --- | --- | --- |
| 상태 변경은 `POST /alarms/:id/dispatch` · `/cancel` | 허용되는 전이를 서버가 정하고, 동작마다 다른 부수효과(발송 건 생성, 대기 건 취소)가 있습니다 | `PATCH /alarms/:id { status }` — 클라이언트가 허용되지 않는 전이를 고를 수 있습니다 | 순수 리소스 모델에서 벗어난 동사형 하위 경로 |
| 발송 시작은 `202 Accepted`와 `DISPATCHING` 알림 | 실제 발송은 워커가 비동기로 하므로 요청 시점에 확정되는 것은 "접수"뿐입니다 | `200`(완료처럼 보임), 발송이 끝날 때까지 대기(10만 건이면 불가능) | 진행 상황은 클라이언트가 단건 조회로 확인 |
| 단건 조회에 발송 건 상태별 개수를 같은 스냅샷으로 | 진행률을 한 번에 보여 주고, 알림 상태와 집계가 다른 시점이면 `COMPLETED`인데 미종결 건이 보이는 모순이 생깁니다 | 별도 집계 API, 두 번의 독립 조회 | 조회마다 `GROUP BY` 집계 1회(`alarm_id`가 앞 열인 unique 인덱스 사용) |
| 목록은 `(createdAt, id)` cursor | 발송 중에도 알림이 생기고 상태가 바뀌어, offset이면 같은 항목이 두 번 나오거나 건너뜁니다 | offset · page 번호 | 임의 페이지로 이동할 수 없고, 페이지 사이의 스냅샷은 보장하지 않습니다(`status`로 거르는 중 지나간 위치의 알림 상태가 바뀌면 다음 페이지에 나오지 않음) |
| 목록 응답 키는 `alarms` | 데이터 모델 예시와 같은 모양으로 맞췄습니다 | 범용 키 `items`(처음 선택) | 리소스마다 목록 키 이름이 달라집니다 |
| 오류는 RFC 9457 + `code` + `errors[]` | 표준 형식이라 클라이언트와 게이트웨이가 공통으로 다룰 수 있고, `code`로 분기하며 필드별 검증 오류를 함께 줍니다 | Nest 기본 `{ statusCode, message }` | `code` · `errors`는 표준 위의 확장 필드 |
| 상태에 해당하는 시각 필드만 응답 | 상태별로 반드시 있는 시각을 타입(판별 union)이 보장하고 `null` 필드가 없습니다 | 모든 시각 필드를 nullable로 | 클라이언트는 `status`를 보고 필드 유무를 판단 |
| OpenAPI 3.0 | 요구 스펙이 3.0이라 `@nestjs/swagger`가 만드는 3.0 문서를 그대로 제공하고 e2e에서 3.0 검증기로 검사합니다 | 3.1 | 3.1 전용 표현(타입 배열 등)을 쓰지 않음 |

### 데이터 모델과 스키마

마이그레이션 SQL은 [`drizzle/`](drizzle)에, 테이블 정의는 `src/modules/notification/adapter/driven/persistence/<개념>/*.table.ts`에 있습니다.

```
alarms 1 ──── N deliveries          (알림 하나 = 수신자별 발송 건 여러 개, 작업 큐를 겸함)
alarms 1 ──── 0..1 expansion_jobs   (대량 알림만, 수신자 확장 진행 상황)
rate_limiters                       (모든 워커가 함께 쓰는 처리량 제한기 행)
```

| 테이블 | 키 | 담는 것 |
| --- | --- | --- |
| `alarms` | PK `id`(uuid, 앱에서 생성) | 제목 · 본문 · 종류(`BULK`/`URGENT`) · 긴급 수신자 목록 · 상태와 전이 시각 |
| `deliveries` | PK `id`(uuid) = 외부 API의 `clientRef`, FK `alarm_id`, UNIQUE `(alarm_id, recipient_id)` | 수신자 1명에 대한 발송 1건의 상태 · 시도 횟수 · lease · 재시도 · reconcile · 결과 |
| `expansion_jobs` | PK이자 FK `alarm_id`(알림당 하나) | 사용자 목록 cursor · 진행 상태(`IN_PROGRESS` · `COMPLETED` · `STOPPED`) · 확장 lease |
| `rate_limiters` | PK `name` | GCRA의 다음 허가 시각 · 429나 연결 실패로 정지된 시각 |

- **상태별 필수 열을 CHECK 제약으로 강제합니다.** 도메인에서 상태는 상태별로 필요한 값만 가진 판별 union이고(예: `SENT`는 `messageId` · `sentAt` · `duplicateCount`), DB에서는 `status` 열과 상태별 열로 펼칩니다. `status = 'SENT'`인데 `message_id`가 없는 행은 DB가 거부하므로, 매퍼의 실수나 도메인을 거치지 않은 쓰기가 있어도 불가능한 상태 조합이 저장되지 않습니다. 대가는 상태가 늘 때마다 마이그레이션이 필요하다는 점입니다.
- **발송 건 id를 `clientRef`로 보냅니다.** 발송 건과 외부 발송 내역이 1:1로 연결되어, 응답을 받지 못한 건을 이 값으로 조회해 확정합니다.
- **`priority_rank`는 `priority`에서 계산되는 생성 열(긴급 0, 대량 1)입니다.** claim 정렬과 인덱스를 같은 열로 맞추기 위해서입니다.

| 키 · 인덱스 | 이유 |
| --- | --- |
| UNIQUE `(alarm_id, recipient_id)` | 같은 알림에서 같은 수신자의 발송 건은 하나뿐입니다. 수신자 확장이 끊겨 같은 페이지를 다시 읽어도 `ON CONFLICT DO NOTHING`으로 중복 생성되지 않고, 알림별 집계도 이 인덱스를 씁니다 |
| `deliveries_claimable_idx` `(priority_rank, created_at, id) WHERE status IN ('PENDING','RETRY_WAIT')` | claim 정렬(긴급 먼저 → 오래된 것 먼저)과 같은 순서의 부분 인덱스. 종결된 행이 쌓여도 인덱스에는 대기 건만 남습니다 |
| `deliveries_reconcilable_idx` `(reconcile_at, id) WHERE status = 'UNKNOWN'` | 확인 시각이 지난 결과 불명 건만 찾습니다 |
| `deliveries_leased_idx` `(lease_expires_at, id) WHERE status = 'IN_FLIGHT'` | lease가 만료된 처리 중 건(멈춘 워커의 건)만 찾습니다 |
| `alarms_created_at_id_idx` `(created_at, id)` | 목록 cursor의 행 비교와 정렬 |
| `expansion_jobs_claimable_idx` `(enqueued_at, alarm_id) WHERE status = 'IN_PROGRESS'` | 진행 중인 확장 작업을 오래된 순으로 찾습니다 |
| FK `alarm_id` (`ON DELETE NO ACTION`) | 발송 건이나 확장 작업이 남은 알림은 지울 수 없어, 발송 이력이 고아가 되거나 함께 사라지지 않습니다 |

발송 건 10만 건에서 claim · reconcile · lease 복구 쿼리가 각각 위 부분 인덱스를 Index Scan으로 쓰는 것을 `EXPLAIN`으로 확인했습니다(읽은 buffer 1~4).

**변경 · 삭제 후의 정보 보존**: 행을 지우는 경로가 없습니다(삭제 API 없음, 취소는 상태만 바꿈, FK가 삭제를 막음). 알림의 제목 · 본문 · 수신자는 생성 후 바꾸는 API가 없어 발송된 내용과 저장된 내용이 어긋나지 않고, 대량 알림의 수신자는 확장 시점의 사용자로 발송 건을 만들어 고정합니다. 종결 상태는 결과를 남깁니다(`SENT`는 messageId · 실제 발송 시각 · 같은 `clientRef` 중복 건수, `FAILED`는 사유, `UNCONFIRMED`는 결과 불명이 시작된 시각, `CANCELLED`는 취소 시각, `attempts`는 요청 시작 횟수). 다만 한 건이 거쳐 간 중간 경과와 시도별 응답은 현재 상태 열을 덮어써서 남지 않습니다([시간이 더 있다면](#시간이-더-있다면)).

**빈 DB에서의 재현**: 스키마는 [`drizzle/`](drizzle)의 순서 있는 SQL 마이그레이션(`0000` ~ `0005`)만으로 만들어지고, 시드 데이터가 필요 없습니다(제한기 행은 첫 허가 때 `INSERT … ON CONFLICT`로 생김). 빈 DB에 적용한 뒤 다시 실행해도 그대로인지 통합 테스트로 확인하고, 모든 통합 · e2e 테스트도 빈 템플릿 DB에 마이그레이션을 적용한 뒤 실행합니다.

### 발송 처리 흐름

```
Alarm      DRAFT ─dispatch─▶ DISPATCHING ─(expanded + 0 unsettled)─▶ COMPLETED
             └──────────cancel──────┴──────────────────────────────▶ CANCELLED

Delivery   PENDING ─claim(leaseToken)─▶ IN_FLIGHT ─202──────────────────────▶ SENT
              ▲                            │ ─400───────────────────────────▶ FAILED
              │                            │ ─500/503/429/unreachable─▶ RETRY_WAIT ─(due, claim)─▶ IN_FLIGHT
              │                            │ ─timeout/lease expired─────────▶ UNKNOWN
              └────────────────────────────┘ (lease too short before request: release)
           UNKNOWN ─(after reconcileAt) found──▶ SENT
                   ─(after reconcileAt) none───▶ RETRY_WAIT | FAILED | CANCELLED
                   ─lookup failed──────────────▶ UNKNOWN (backoff, retry lookup)
                   ─(after confirm window)─────▶ UNCONFIRMED (terminal, needs review)
           PENDING · RETRY_WAIT ─cancel─▶ CANCELLED
```

API와 워커는 같은 유스케이스 계약(driving port)으로 같은 도메인 규칙과 저장소를 씁니다. 트랜잭션 경계는 유스케이스가 정하고, 외부 HTTP 호출은 항상 트랜잭션 밖에서 합니다. 요청 동안 행 잠금이나 DB 연결을 붙잡지 않기 위해서입니다.

| 진입점 | 유스케이스 | 한 트랜잭션에서 하는 일 | 트랜잭션 밖에서 하는 일 |
| --- | --- | --- | --- |
| `POST /alarms` | CreateAlarm | 알림 생성(`DRAFT`) | - |
| `POST /alarms/:id/dispatch` | StartDispatch | 알림 잠금 → `DISPATCHING`. 긴급 알림이면 수신자별 발송 건 생성, 대량 알림이면 확장 작업 등록 | - |
| `POST /alarms/:id/cancel` | CancelAlarm | 알림 잠금 → `CANCELLED`, 대기 중인 발송 건 일괄 `CANCELLED`(수신자 확장은 다음 페이지를 저장할 때 알림 상태를 보고 멈춤) | - |
| `GET /alarms/:id` · `GET /alarms` | GetAlarm · ListAlarms | 알림과 상태별 발송 건 수를 같은 스냅샷에서 조회 · 필터와 cursor로 한 페이지 조회 | - |
| 확장 루프 | ExpandNextPage | ① 확장 작업 하나를 lease로 claim ② 알림이 아직 발송 중인지 확인 → 발송 건 생성 → cursor 저장 | ①과 ② 사이에 사용자 API 한 페이지 조회 |
| 발송 루프 ×N | SendNextDelivery | ① 최우선 1건 claim(새 `leaseToken`) · 요청 시작 기록 ② `leaseToken`이 그대로일 때만 결과 저장 | ① 전에 발송 허가 획득, ① 뒤에 남은 lease 재확인 → 발송 요청 |
| reconcile 루프 | ReconcileNextDelivery | ① 확인 시각이 지난 `UNKNOWN` 1건을 골라 확인 시각을 `DISPATCH_LEASE_MS`만큼 미뤄 예약 ② 조회 결과로 확정(확인 시각 · 조회 실패 횟수가 그대로일 때만) | 발송 내역 조회 |
| lease 복구 루프 | RecoverExpiredLease | lease가 만료된 `IN_FLIGHT` 1건 → `UNKNOWN` | - |
| 완료 확인 루프 | CompleteSettledAlarms | 발송 중인 알림 100개를 읽고, 알림마다 잠금 → 수신자 확장 완료 · 미종결 0건이면 `COMPLETED` | - |

**완료 판정은 결과마다가 아니라 주기적으로 합니다.** 알림이 발송 건을 직접 읽지 않고, 완료 확인 유스케이스의 내부 협력자(`AlarmCompletionChecker`)가 "수신자 확장 완료 여부"와 "미종결 발송 건 수"를 조회해 알림에 넘깁니다. 결과가 확정될 때마다 호출하면 수신자 10만 명인 알림 하나에서 미종결 집계가 10만 번 돌기 때문입니다. 대신 마지막 결과가 확정된 뒤 `COMPLETED`가 되기까지 한 바퀴 순회 시간과 `COMPLETION_CHECK_INTERVAL_MS`(1초)만큼 늦어질 수 있습니다. 한 번에 한 페이지만 처리해 종료할 때 기다릴 일이 짧고, 알림 하나의 판정이 실패해도 경고 로그를 남기고 다음 알림으로 넘어갑니다.

### 워커 간 작업 분배

워커 프로세스는 모두 대칭이고 조정자(leader)가 없습니다. 각 워커가 아래 루프를 돌리며 DB에서 할 일을 직접 가져갑니다. 루프는 일을 했으면 바로 다시, 할 일이 없으면 `WORKER_POLL_INTERVAL_MS`(100ms) 뒤에, 예외가 나면 로그를 남기고 `WORKER_ERROR_DELAY_MS`(1초) 뒤에 다시 실행합니다.

| 루프 | 개수 | 한 번에 하는 일 |
| --- | --- | --- |
| 확장 | 1 | 확장 작업 한 페이지(사용자 1,000명) |
| 발송 | `DISPATCH_CONCURRENCY`(8) | 발송 허가 1개 → 발송 건 1건 claim → 발송 → 결과 저장 |
| reconcile | 1 | 결과 불명 1건 확정 |
| lease 복구 | 1 | 만료된 lease 1건 |
| 완료 확인 | 1 | 발송 중인 알림 한 페이지(100개) |

| 결정 | 왜 | 검토한 대안 | 감수한 대가 |
| --- | --- | --- | --- |
| PostgreSQL 단독, `deliveries` 테이블이 곧 작업 큐 | 알림 상태 변경과 작업 생성이 함께 성공해야 합니다. 브로커를 따로 두면 두 저장소에 나눠 쓰는 이중 쓰기가 생기고, 다중 워커의 동시성 · 장애 복구 · 처리량 공유를 저장소 하나로 설명할 수 있습니다 | Redis(BullMQ), RabbitMQ · Kafka + outbox 테이블 | 지연 큐 · 대시보드 같은 큐 기능을 직접 만들고, 폴링 비용과 DB 단일 병목을 감수 |
| `FOR UPDATE SKIP LOCKED`로 1건씩 claim | 워커 수와 관계없이 서로 다른 건을 잠금 대기 없이 가져갑니다 | advisory lock, 워커별 파티션 할당(대수가 바뀌면 재분배 필요) | 1건마다 트랜잭션 1회라 배치 claim보다 DB 왕복이 많음 |
| lease(만료 시각) + claim마다 새 `leaseToken`(fencing) | 워커가 죽어도 lease 만료 후 다른 워커가 이어받고, 늦게 깨어난 워커의 결과 저장은 토큰 불일치로 거부됩니다 | 요청 동안 행 잠금 유지(트랜잭션 안에서 HTTP 호출), 하트비트로 lease 연장 | 죽은 워커의 건은 lease 만료(30초) + reconcile 지연(35초)만큼 늦게 확정 |
| 수신자 확장은 1,000명 페이지마다 "발송 건 생성 + cursor 저장"을 한 트랜잭션으로, 확장 작업에도 lease | 10만 건을 발송 시작 요청에서 만들지 않고, 도중에 워커가 죽어도 다른 워커가 마지막으로 커밋한 페이지부터 이어받습니다. 같은 페이지를 다시 읽어도 unique 제약으로 중복이 생기지 않습니다 | 발송 시작 요청에서 전체 생성, 전체를 메모리에 읽고 한 번에 저장 | 확장과 발송이 동시에 진행되어, 확장이 끝나기 전에는 총 건수가 늘어 보입니다 |
| reconcile 대상을 고를 때 확인 시각을 `DISPATCH_LEASE_MS`만큼 미뤄 예약 | 조회는 트랜잭션 밖에서 하므로, 잠금이 풀린 사이 다른 워커가 같은 건을 또 조회하지 않게 합니다 | 조회하는 동안 행 잠금 유지 | 조회 중 워커가 죽으면 그 건은 미룬 시간만큼 늦게 다시 대상이 됩니다 |
| 모든 워커가 같은 루프를 대칭으로 실행 | 리더 선출이나 파티션 재분배 없이 한 대가 죽어도 남은 워커가 그대로 이어받습니다 | 리더가 작업을 배정 | 모든 워커가 같은 알림의 완료 확인을 중복 수행(결과는 멱등) |

### 처리량 제한 준수

| 결정 | 왜 | 검토한 대안 | 감수한 대가 |
| --- | --- | --- | --- |
| 공유 제한기를 PostgreSQL 행 하나에 두고 원자적 `INSERT … ON CONFLICT DO UPDATE … WHERE … RETURNING` 한 문장으로 허가 | 초당 50건은 워커 전체의 합계라 공유 상태가 필요하고, 이미 쓰는 PostgreSQL로 원자성을 얻습니다 | 워커마다 50/N으로 나누기(대수가 바뀌면 재설정, 쉬는 워커 몫이 낭비), Redis 토큰 버킷(인프라 추가) | 허가 1개마다 DB 쓰기 1회 |
| GCRA로 burst 없이 20ms 간격 허가 | 용량 50, 초당 50개 보충인 일반 토큰 버킷은 가득 찬 상태에서 첫 1초에 최대 100건이 나가므로, **임의의 1초 구간**에서 50건 이하를 보장하려고 간격을 고르게 띄웁니다 | 일반 토큰 버킷, 벽시계 1초 창 카운터(창 경계에서 2배) | 늦게 나간 허가를 만회하지 않아 동시 요청자가 적으면 한도보다 낮은 처리량 |
| 허가 시각은 DB 시계(`clock_timestamp()`)로 판정 | 20ms 간격이라 워커 사이의 ms 단위 시계 차이도 한도 초과로 이어질 수 있습니다 | 워커 시계 | 판정마다 DB 왕복이 필요(어차피 허가는 DB에서 받음) |
| 429를 받으면 `Retry-After`만큼 제한기를 정지, 더 짧은 값으로 앞당기지 않음 | 한 워커가 받은 429를 모든 워커가 함께 존중해야 429가 이어지지 않습니다 | 그 건만 재시도 | 정지 동안 모든 발송이 멈춤 |

- mock의 한도 방식은 로컬 Docker에서 따로 측정했고, 관측은 토큰 버킷(용량 약 50, 초당 50개 연속 보충)과 맞았습니다. 60건을 동시에 보내면 52건이 성공했고, 소진 직후에는 경과 시간 × 50/s만큼만 성공했으며, 벽시계 초 경계와 관계없이 약 150ms 만에 다시 성공했고, `Retry-After`는 매번 `1`이었습니다. 우리 제한기는 이보다 엄격한 기준을 지킵니다.
- 특성 테스트(EXT-10)는 우리 제한기를 거친 부하(동시 발송 20개, 제한기 없이는 429가 나는 수준)에서 2초 동안 429가 없고 한도의 80% 이상 성공하는지 확인합니다.
- burst가 없는 허가는 동시 요청자가 적으면 한도보다 느립니다(같은 환경에서 동시 발송 3개 약 75%, 6개 약 88%, 20개 약 95%). 한도 준수를 우선하고, 처리량은 워커 대수와 `DISPATCH_CONCURRENCY`로 맞춥니다.

### 긴급 알림 우선 처리

긴급 알림과 대량 알림은 같은 제한기(초당 50건)를 함께 씁니다. "먼저 처리"는 [명세 해석](#명세-해석)대로 "발송 가능한 긴급 건이 있는 동안, 발송 허가를 얻은 요청은 긴급 건을 보낸다"로 정의했습니다.

| 결정 | 왜 | 검토한 대안 | 감수한 대가 |
| --- | --- | --- | --- |
| 발송 허가를 먼저 얻고, 그 순간 발송 가능한 건 중 최우선 1건을 claim해 바로 보냄 | 발송 건을 claim해 둔 채 허가를 기다리면, 그 사이 생긴 긴급 건이 이미 잡힌 대량 건 뒤로 밀립니다 | claim → 허가 대기(더 단순), 긴급 전용 큐 · 워커 분리(한도를 나눠야 함) | 허가를 얻었는데 보낼 건이 없으면 그 허가는 버려짐(한도를 넘지는 않음) |
| `priority_rank`(긴급 0, 대량 1) 생성 열과, 같은 순서 `(priority_rank, created_at, id)`의 부분 인덱스로 claim | 대기 건이 10만 건이어도 최우선 1건을 인덱스 첫 항목으로 찾고, 우선순위 규칙은 생성식 하나에 모입니다 | 긴급 · 대량 테이블 분리, 애플리케이션에서 두 번 조회 | 우선순위 단계가 늘면 생성식과 인덱스 마이그레이션이 필요 |
| 재시도 대기 중인 긴급 건은 대량 발송을 막지 않음 | 재시도 시각 전의 긴급 건 때문에 허가를 비워 두면 공유 한도만 낭비됩니다 | 긴급 건이 남아 있는 동안 대량 발송 전체 정지 | 재시도 대기 동안에는 대량 건이 나감 |

e2e(E2E-03)는 대량 발송 중 긴급 알림을 시작하고, "긴급 발송을 시작한 시점에 이미 시작된 대량 건 + 동시 발송 수"를 넘는 대량 발송이 마지막 긴급 발송보다 먼저 나가지 않았는지 mock 발송 내역으로 판정합니다.

### 복원력 패턴

| 패턴 | 적용 | 왜 |
| --- | --- | --- |
| 처리량 제한 | PostgreSQL 공유 GCRA 제한기, 모든 워커 합계 초당 50건 | mock이 한도를 넘으면 429를 돌려줍니다 |
| 요청 타임아웃 | 발송 · 발송 내역 조회 · 사용자 목록 요청마다 `AbortSignal.timeout(5s)`(`DISPATCH_MAX_REQUEST_MS`). lease보다 짧아야 기동됩니다 | mock은 일부 요청에 30초 동안 응답하지 않아, 기다리면 동시 발송 슬롯이 묶입니다 |
| 재시도 + 지수 백오프 + jitter | 500/503은 1초부터 2배씩 최대 60초, 최대 5회(`RETRY_*`). 발송 내역 조회 실패는 5초부터 최대 60초로 `UNCONFIRMED_AFTER_MS`(1시간)까지. 지연은 계산값의 50~100% 사이 무작위 | 500/503은 "발송되지 않음"이 보장되어 재전송이 안전하고, jitter는 여러 워커의 재시도가 한 시각에 몰리지 않게 합니다 |
| 공유 정지(서킷 브레이커 역할) | 429는 `Retry-After`만큼, 발송 API에 연결 자체를 못 하면(연결 거부 · 주소 해석 실패) 5초 동안 제한기를 멈춰 모든 워커가 함께 쉽니다. 연결 실패 건은 시도 횟수를 쓰지 않고 `RETRY_WAIT`(`UNREACHABLE`)로 둡니다. 정지가 끝나면 허가가 다시 20ms 간격으로 한 건씩 나가므로 첫 요청이 시험 요청 역할을 하고, 또 실패하면 곧바로 다시 멈춥니다 | 죽은 서비스에 요청을 쏟지 않고, 장애가 길어도 대기 건을 시도 횟수 소진으로 `FAILED` 처리하지 않습니다. 연결조차 안 된 요청은 나가지 않은 것이 확실하므로 결과 불명으로 보내지 않습니다 |
| 재전송 대신 조회(reconcile) | 타임아웃 · 요청 후 연결 끊김 · lease 만료는 `UNKNOWN`으로 두고, `RECONCILE_DELAY_MS` 이후 `clientRef`로 발송 내역을 조회해 확정 | mock은 중복 발송을 막지 않으므로, 결과를 모르는 건을 바로 재전송하면 중복이 생깁니다 |
| 종결 상태 `UNCONFIRMED` | 확인 기간 안에 확정하지 못하면 재전송 없이 종결하고 `FAILED`와 따로 집계 | 조회가 계속 실패해도 알림이 끝나지 않는 일을 막고, 실제로 나갔을 수 있는 건을 운영 확인 대상으로 남깁니다 |

**오류율 기반 서킷 브레이커는 두지 않았습니다.** mock의 5xx는 요청의 약 5%에서 무작위로 나는 일시 오류라 지수 백오프로 충분히 흡수됩니다. 오류율로 회로를 열면 정상 요청까지 막아 처리량만 줄어듭니다. 서킷 브레이커가 막으려는 "응답하지 않는 서비스에 계속 요청하는" 상황은 연결 실패 공유 정지와 요청 타임아웃이, 과부하 신호는 429 공유 정지가 맡습니다. 실제 발송 서비스에서 지속적인 5xx가 관측되면 같은 제한기 정지에 오류율 조건을 더하는 방식으로 넓힐 수 있습니다.

### 중복과 누락을 막는 방법

| 상황 | 처리 |
| --- | --- |
| 같은 수신자의 발송 건이 두 번 생김 | `(alarm_id, recipient_id)` unique 제약 + `ON CONFLICT DO NOTHING` |
| 워커 두 대가 같은 건을 가져감 | `FOR UPDATE SKIP LOCKED` + lease |
| lease를 잃은 워커의 늦은 결과 | claim마다 새 `leaseToken`을 발급하고, 토큰과 상태가 일치할 때만 결과 저장(fencing) |
| lease가 거의 끝난 상태에서 새 요청 | 남은 lease가 요청 타임아웃보다 짧으면 요청을 시작하지 않고 반납. claim 커밋이 늦어질 수 있어 요청 직전에 한 번 더 확인 |
| 응답 타임아웃 · 요청 후 연결 끊김 · lease 만료 | **재전송하지 않고** `UNKNOWN`으로 둔 뒤, reconcile 가능 시각(마지막 요청 시작 또는 lease 만료 + `RECONCILE_DELAY_MS`) 이후 발송 내역 조회. 내역이 있으면 `SENT`, 없으면 최대 시도 횟수 안에서 재전송 |
| 두 워커가 같은 결과 불명 건을 조회 | 고를 때 확인 시각을 미뤄 예약하고, 확정은 확인 시각 · 조회 실패 횟수가 그대로일 때만 저장 |
| 수신자 확장 도중 워커 종료 | 확장 작업 lease가 만료되면 다른 워커가 마지막으로 커밋한 cursor부터 이어서 읽음 |
| 발송 중 워커 강제 종료 | 그 워커가 쥔 건은 lease 만료 후 `UNKNOWN`으로 복구되어 발송 내역 조회로 확정(재전송 없음) |
| 발송 중 취소 | 대기 건을 한 번에 `CANCELLED`로 바꾸고, claim과 결과 저장 때도 알림 상태를 다시 확인. 이미 나간 요청은 결과대로 기록 |

**가정**: 클라이언트가 요청을 끊어도 서버는 이미 받은 요청을 계속 처리할 수 있으므로, reconcile 대기 시간은 클라이언트 타임아웃이 아니라 서버 쪽 근거로 정합니다. 근거는 mock 명세의 "타임아웃 건은 발송은 처리되고 응답만 최대 `TIMEOUT_MS`(30초) 늦게 온다"이고, `RECONCILE_DELAY_MS`(35초)를 그보다 길게 둡니다. "발송 내역이 응답보다 먼저 기록된다"는 특성 테스트(EXT-11)로 확인합니다.

**한계**: 외부 API가 멱등 키를 지원하지 않으므로 exactly-once는 보장할 수 없습니다. 프로세스가 lease 확인 직후 요청 전송 직전에 오래 멈추면, 이전 워커의 늦은 요청이 복구 이후에 나갈 수 있습니다. 이런 중복은 reconcile 조회 때 같은 `clientRef` 내역이 2건 이상 나오면 기록하지만, 이미 `SENT`로 확정된 뒤 생긴 중복은 드러나지 않습니다.

### 운영 구성과 종료

| 결정 | 왜 | 검토한 대안 | 감수한 대가 |
| --- | --- | --- | --- |
| 마이그레이션을 별도 일회성 `migrate` 엔트리포인트 · 컨테이너로 | 앱 기동 때 마이그레이션하면 api · worker 여러 개가 동시에 실행하는데, Drizzle의 `migrate()`는 잠금을 잡지 않습니다 | 앱 기동 시 실행, advisory lock으로 감싸기 | 실행 단계가 하나 늘어남(compose가 순서를 보장) |
| 기동 시 env를 zod로 검증하고 서로 맞지 않는 조합을 거부(lease ≤ 요청 타임아웃, 허가 간격 < 20ms, 종료 타이머 상한 초과 등) | 잘못된 설정은 실행 중이 아니라 기동할 때 실패해야 합니다 | 쓰는 시점에 검증 | 설정을 추가할 때마다 스키마를 갱신 |
| `/livez`(의존성을 보지 않음)와 `/readyz`(종료 중이거나 DB 무응답이면 503) 분리 | liveness가 DB를 보면 DB 장애 때 멀쩡한 프로세스까지 재시작됩니다 | 단일 `/health` | 엔드포인트가 둘 |
| 호스트에는 api 3000번만 공개 | PostgreSQL과 mock은 내부 의존성이라 밖에 열 이유가 없습니다 | 개발 편의를 위한 포트 공개 | 로컬 개발 때 PostgreSQL과 mock을 따로 띄움 |
| PostgreSQL 연결 수 `DATABASE_POOL_MAX`(20) | 워커 한 프로세스가 루프 12개(발송 8 + 4)를 돌려, pg 기본값 10이면 연결을 기다리는 루프가 생깁니다 | pg 기본값 10 | (워커 대수 + api) × 20이 PostgreSQL `max_connections`(기본 100)를 넘지 않게 조정해야 함 |

종료는 Nest의 lifecycle 단계 순서를 그대로 씁니다. 같은 단계 안의 실행 순서는 모듈 깊이와 등록 순서에 좌우되므로, 앞뒤가 중요한 일은 서로 다른 단계에 둡니다.

1. 종료 신호를 받는 즉시 readiness를 내리고, 제한 시간(`SHUTDOWN_DRAIN_MS` + `SHUTDOWN_TIMEOUT_MS`)을 재는 감시 타이머를 시작합니다.
2. `onModuleDestroy`: 모든 루프에 정지를 알립니다. 정지 요청 뒤에는 발송 허가를 막 얻은 루프도 새 발송 건을 claim하지 않고, 진행 중인 발송 요청과 결과 저장이 끝나기를 기다립니다.
3. `beforeApplicationShutdown`: drain 시간만큼 기다려 로드밸런서가 트래픽을 끊을 시간을 줍니다.
4. `onApplicationShutdown`: DB 연결을 닫고 exit 0으로 끝납니다.
5. 제한 시간 안에 끝나지 않으면 exit 1로 강제 종료합니다. 결과를 저장하지 못한 발송 건은 lease를 가진 채 남고, lease가 만료되면 다른 워커가 `UNKNOWN`으로 복구해 발송 내역 조회로 확정합니다. 끝나지 않는 요청 때문에 종료가 무한정 늘어지지 않게 하려는 것이고, 대가는 그 건의 확정이 lease 만료 + reconcile 지연만큼 늦어진다는 점입니다.

1 · 3 · 5번은 api와 worker가 같은 종료 조율(`ShutdownService`)을 씁니다. compose의 `stop_grace_period`(35초)는 drain + 제한 시간(30초)보다 길게 둡니다. 종료 타이머 값과 그 합은 Node 타이머 상한(2,147,483,647ms) 이하로 검증합니다. 상한을 넘는 타이머는 Node가 1ms로 바꿔 실행해 기동 직후 강제 종료로 이어지기 때문입니다.

### 성능

- **대량 알림 10만 건**: 발송 시작 요청은 알림 상태와 확장 작업만 저장하고 바로 응답합니다. 발송 건은 워커가 1,000명 페이지 단위로 만들고, 확장이 진행되는 동안 이미 만든 건부터 발송합니다.
- **대기열 조회 비용**: claim · reconcile · lease 복구가 상태별 부분 인덱스를 써서, 종결된 행이 쌓여도 대기열 조회 비용이 커지지 않습니다(10만 건에서 `EXPLAIN` 확인).
- **측정 한 번**: `docker compose up --scale worker=3`에 mock 기본값(일시 오류 5%, 3초 이상 지연 5%, 30초 타임아웃 2%)으로 10만 명 알림을 보내 보니 429는 0건이었고, 처음 20초 동안 약 29건/초를 보냈습니다. 그 사이 확장도 함께 진행됐고, 느린 응답과 타임아웃이 동시 발송 슬롯을 붙잡는 영향이 커 보입니다(측정으로 원인을 나누지는 않았습니다). 처리량은 한도 준수를 우선해 이 수준에서 멈췄고, 개선 방향은 [시간이 더 있다면](#시간이-더-있다면)에 적었습니다.

### 아키텍처

원전의 원칙과 이 프로젝트의 선택을 나눠 적습니다. 폴더 이름과 배치는 원전이 강제하지 않는 프로젝트 관례입니다.

```
┌─ adapter/driving ────────────────────┐   ┌─ adapter/driven ─────────────────────────┐
│ web    : controller · request schema │   │ persistence : alarm · delivery ·         │
│          · presenter                 │   │               expansion-job ·            │
│ worker : polling loops (expand ·     │   │               transaction · rate limiter │
│          send · reconcile · lease    │   │ mock-api    : message · recipient        │
│          recovery · completion)      │   │ system      : clock · ids · jitter       │
│                                      │   │ config      : env → settings types       │
└───────────────────┬──────────────────┘   └─────────────────────┬────────────────────┘
                    │ calls driving ports                        │ implements driven ports
                    ▼                                            ▼
┌─ application ───────────────────────────────────────────────────────────────────────┐
│ port/driving/for-managing-alarms     CreateAlarm · GetAlarm · ListAlarms ·          │
│                                      StartDispatch · CancelAlarm                    │
│ port/driving/for-dispatching-alarms  ExpandNextPage · SendNextDelivery ·            │
│                                      ReconcileNextDelivery · RecoverExpiredLease ·  │
│                                      CompleteSettledAlarms                          │
│ service/{alarm,delivery,expansion,   use case implementations · settings types ·    │
│          completion}                 AlarmCompletionChecker                         │
│ port/driven/for-storing-alarms · for-storing-deliveries ·                           │
│             for-storing-expansion-jobs · for-running-transactions ·                 │
│             for-sending-messages · for-looking-up-messages ·                        │
│             for-fetching-recipients · for-permitting-sends ·                        │
│             for-telling-time · for-generating-ids · for-drawing-jitter              │
└───────────────────────────────────────────┬─────────────────────────────────────────┘
                                            │ uses
                                            ▼
┌─ domain ────────────────────────────────────────────────────────────────────────────┐
│ alarm/     Alarm aggregate      DRAFT → DISPATCHING → COMPLETED | CANCELLED         │
│ delivery/  Delivery aggregate   claim · lease · attempt · result · RetryPolicy      │
│ no Nest, no DB, no HTTP, no zod                                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

| 원칙 (출처) | 이 프로젝트의 적용 |
| --- | --- |
| 의존성은 안쪽으로만 향한다 (Clean Architecture) | adapter → application → domain. domain과 application은 Nest · DB · HTTP · zod를 모릅니다 |
| 애플리케이션과 바깥 기술을 port로 분리한다 (Ports & Adapters, Cockburn) | driving adapter(controller, 워커 루프)는 driving port에만 의존하고, driven adapter가 driven port를 구현합니다 |
| 경계를 넘는 데이터는 단순한 구조로 (Clean Architecture) | 유스케이스의 입력 · 결과는 application이 소유한 readonly 데이터입니다. driving adapter는 도메인 타입을 import하지 않고, presenter는 결과만 HTTP 응답으로 바꿉니다. 저장소 같은 driven adapter는 Aggregate를 저장 · 복원하는 역할이라 도메인 타입을 씁니다 |
| Aggregate가 자기 불변식을 지킨다 (DDD) | 알림은 상태 전이를, 발송 건은 시도 · lease · 결과 전이를 스스로 검사합니다 |
| Repository는 Aggregate를 저장하고 복원한다 (Evans · Fowler) | 저장소 port는 Aggregate를 주고받고, 같은 계약 테스트를 fake와 Drizzle adapter에 함께 돌립니다 |
| 쓰지 않는 의존성은 받지 않는다 (ISP) | 서비스는 저장소 port의 메서드 중 실제로 쓰는 것만 `Pick`으로 받습니다(아래) |

| 결정 | 왜 | 검토한 대안 | 감수한 대가 |
| --- | --- | --- | --- |
| port를 `port/driving` · `port/driven`으로 나누고, 그 아래를 `for-<목적>` 폴더로 묶음 | Cockburn은 port를 "목적이 있는 대화"로 보고 `For_doing_something` 형태로 이름 짓습니다. 이 용어와 Garrido de Paz가 정리한 참조 배치를 따르면 폴더 이름만으로 앱이 바깥과 어떤 대화를 하는지 보이고, 같은 목적의 계약(예: `for-generating-ids`의 id 생성기 3개)이 한곳에 모입니다 | 종류별 `port/in` · `port/out`(처음 구조). 20개 가까운 계약이 목적과 상관없이 한 폴더에 섞였고, in/out은 목적이 아니라 방향만 말합니다 | 경로가 길어지고, 원전이 정하지 않은 배치라 설명이 필요 |
| driving port는 유스케이스마다 하나(abstract class), 목적 폴더(`for-managing-alarms` · `for-dispatching-alarms`)로 묶음 | controller와 워커 루프가 구현이 아닌 계약에만 의존하고, 유스케이스마다 입력 · 결과 타입이 분명해집니다 | 서비스 클래스를 직접 주입 | 유스케이스마다 계약 파일과 타입 파일이 생김. hexagonal의 필수 조건이 아닌 일관성을 위한 선택 |
| 저장소 port는 개념마다 하나(`AlarmRepositoryPort` · `DeliveryRepositoryPort` · `ExpansionJobRepositoryPort`). `TransactionPort.run`은 세 저장소를 넘기고, 서비스는 콜백 파라미터를 `Pick<…>`으로 좁힌 자기 인터페이스로 선언 | 서비스가 실제로 쓰는 메서드만 호출하도록 컴파일러가 막아 ISP를 타입으로 강제하면서, port와 adapter 수는 개념 수로 유지합니다 | 쓰임새별 port 분리(처음 구조. 발송 건 저장소만 6개였고 adapter 하나가 모두 구현) | 저장소 port 하나의 메서드 수는 많음. 좁히는 선언이 서비스마다 있음 |
| 설정은 port가 아니라 서비스가 소유한 readonly 설정 타입(`DispatchSettings` · `ReconcileSettings` · `ExpansionSettings` 등). `WorkerSettingsFactory`가 env를 검증해 만들고 모듈이 생성자로 넘김 | 설정은 행위가 없는 값이라 바꿔 끼울 구현이 없습니다. 값을 그대로 넘기면 테스트에서도 바로 만들어 씁니다 | 설정 port 4개(처음 구조) | 설정을 바꾸려면 재기동(이전과 같음) |
| 완료 판정은 driving port가 아니라 내부 협력자 `AlarmCompletionChecker` | 바깥에서 직접 부르지 않는, 완료 확인 유스케이스의 내부 단계라 계약으로 드러낼 이유가 없습니다 | 별도 유스케이스 계약 | 조립 시 직접 만들어 넘김 |
| 서비스는 Nest를 모르는 일반 클래스이고 모듈이 `useFactory`로 조립 | application이 프레임워크에 의존하지 않아 unit 테스트가 Nest 없이 돌고, 의존 방향이 안쪽으로만 향합니다 | 서비스에 `@Injectable` | 모듈의 조립 코드가 길어짐 |
| 성공과 실패를 예외 대신 `kind` 판별 union으로. 외부 발송 결과(`SendOutcome`: accepted · permanent-failure · transient-failure · rate-limited · unreachable · indeterminate)도 port 계약에 둠 | 호출하는 쪽이 모든 경우를 다루지 않으면 컴파일 오류가 나서 처리 누락을 막습니다 | 예외 계층 | 결과를 매번 좁혀야 해서 코드가 길어짐 |
| 트랜잭션은 `TransactionPort.run`(쓰기)과 `readSnapshot`(`REPEATABLE READ`, `READ ONLY`). 스냅샷에는 조회 메서드만 `Pick`한 저장소를 넘김 | 여러 변경이 함께 성공해야 하면 한 트랜잭션의 저장소로 읽고 쓰고, 알림 상태와 발송 건 집계처럼 같은 시점이 필요한 조회는 스냅샷으로 읽습니다. 스냅샷 안의 쓰기는 타입으로 막힙니다 | 기본 `READ COMMITTED`로 두 번 조회(두 조회가 서로 다른 시점을 볼 수 있음) | 변경 추적이 없는 실행기라 Fowler의 Unit of Work와는 범위가 다름 |
| in-memory fake와 계약 테스트를 모듈의 `testing/`에 둠 | 같은 계약 테스트를 fake와 Drizzle adapter 양쪽에 돌려 fake가 실제처럼 동작함을 보장합니다. 운영 빌드에서는 제외합니다 | fake를 adapter 폴더에 | 테스트 지원 코드가 모듈 안에 함께 있음 |

**의도한 타협**: 발송 시작(알림 상태 변경 + 발송 건 또는 확장 작업 생성)과 수신자 확장 페이지(알림 상태 잠금 조회 + 발송 건 생성 + cursor 저장)는 두 Aggregate를 한 트랜잭션에 저장합니다. DDD(Vernon)는 Aggregate 사이를 최종 일관성으로 두기를 권하지만, "알림은 발송 중인데 발송 작업이 없는" 이중 쓰기 불일치를 막기 위해서입니다. 단일 PostgreSQL이라 브로커 없이 원자성을 얻을 수 있고, 상태 변경과 작업 생성이 함께 성공해야 하는 이 두 명령에만 씁니다. 대가로 두 Aggregate를 다른 저장소로 나누기 어려워집니다.

**바깥 계층이 원래 맡는 일**(원칙에서 벗어난 것이 아님):

- 처리량 제한기만 DB 시계로 판정합니다. claim · lease 복구 · reconcile은 워커 시계(`ClockPort`)로 판정하고 워커 호스트의 NTP 동기화를 가정합니다. 이 판정의 단위는 lease 30초 · reconcile 지연 35초라 수 ms 차이는 결과를 바꾸지 않습니다. 시계가 크게 어긋나면 fencing이 늦은 결과의 저장은 막지만, 다른 워커가 같은 건을 다시 보내는 외부 중복까지 막지는 못합니다. 도메인 규칙은 시각을 인자로 받으므로 시각의 출처를 바꿔도 도메인은 그대로입니다.
- health의 DB 확인은 비즈니스 규칙이 없는 기술 관심사라 driven adapter가 Pool로 직접 확인합니다.
- 종료 조율(bootstrap)이 Pool을 직접 닫습니다. drain이 끝난 뒤, 감시 타이머가 살아 있는 동안 닫는 순서를 한 곳에서 보장하려는 것입니다.

| 바꾸고 싶은 것 | 고치는 곳 | 그대로인 곳 |
| --- | --- | --- |
| 외부 발송 서비스(예: FCM, SENS) | `adapter/driven/`에 `MessageSenderPort` · `MessageLookupPort` 구현 추가, 워커 모듈 바인딩 | domain · application · DB |
| 처리량 한도 · lease · 재시도 · reconcile 시간 | env. 서로 맞지 않는 조합은 기동 시 거부 | 코드 |
| 워커 대수 · 워커당 동시 발송 수 | `--scale worker=N`, `DISPATCH_CONCURRENCY` | 코드 · 스키마 |
| 우선순위 규칙 | `priority_rank` 생성식과 claim 정렬(같은 열 하나) | 발송 · 재시도 · reconcile 로직 |
| 저장소 기술 | `adapter/driven/persistence`, 같은 계약 테스트로 검증 | domain · application · 다른 adapter |
| HTTP 응답 모양 | presenter와 응답 타입 | 유스케이스 · 도메인 |
| 상태 전이 규칙 | `Alarm` · `Delivery` 엔티티 | 유스케이스는 결과 union만 다룸 |

### 파일 구조

```
src/
├── main.ts · worker.ts · migrate.ts       api · worker · migrate 엔트리포인트
├── bootstrap/                             composition root: 루트 모듈, 종료 조율(lifecycle), 기동 · OpenAPI(server)
├── shared/                                config(zod env) · database(Pool · 마이그레이션) · http(RFC 9457) · logging · domain(brand)
└── modules/
    ├── health/                            /livez · /readyz (notification과 같은 driving/driven 배치)
    └── notification/
        ├── domain/{alarm,delivery}/
        ├── application/
        │   ├── port/driving/{for-managing-alarms,for-dispatching-alarms}/
        │   ├── port/driven/for-storing-{alarms,deliveries,expansion-jobs}/ · for-running-transactions/
        │   │              for-{sending,looking-up}-messages/ · for-fetching-recipients/ · for-permitting-sends/
        │   │              for-telling-time/ · for-generating-ids/ · for-drawing-jitter/
        │   └── service/{alarm,delivery,expansion,completion}/
        ├── adapter/
        │   ├── driving/{web,worker}/
        │   └── driven/persistence/{alarm,delivery,expansion-job,rate-limiter}/ · mock-api/{message,recipient}/
        │             system/ · config/
        ├── testing/{in-memory,contract}/  fake 저장소 · 트랜잭션, 저장소 계약 테스트 (운영 빌드 제외)
        ├── notification-api.module.ts     api 쪽 조립
        └── notification-worker.module.ts  worker 쪽 조립
drizzle/                                   SQL 마이그레이션
test/                                      e2e
```

테스트는 구현 파일 옆에 두고, 여러 구현이 함께 쓰는 계약 테스트와 테스트용 컨테이너만 `testing/`에 모읍니다.

### 기술 선택

| 영역 | 선택 | 이유 | 검토한 대안 |
| --- | --- | --- | --- |
| 언어 · 프레임워크 | TypeScript 7 · NestJS 12 | 모듈 · DI · lifecycle로 api와 worker를 같은 구조로 조립합니다. TS7(tsgo)은 타입 검사가 빠릅니다 | TS 5.x. TS7에는 compiler API가 없어 빌드 도구를 바꿔야 했습니다 |
| 빌드 · 테스트 변환 | SWC | TS7에서 Nest CLI 빌드(tsc compiler API)를 쓸 수 없어, SWC로 빌드 · watch · 테스트 변환을 하고 `tsc --noEmit`으로 타입만 검사합니다 | Nest CLI + tsc, webpack |
| 저장소 · 큐 | PostgreSQL 18 | 상태와 작업 큐를 한 트랜잭션에 두고, `SKIP LOCKED` · 부분 인덱스 · CHECK 제약 · 생성 열을 씁니다 | Redis · 메시지 브로커 추가([워커 간 작업 분배](#워커-간-작업-분배)) |
| DB 접근 | Drizzle ORM 0.45 | 코드 생성 없는 순수 TS이고, `FOR UPDATE SKIP LOCKED` · `ON CONFLICT … WHERE` 같은 SQL을 그대로 표현하며 SQL 마이그레이션을 만듭니다 | Prisma(잠금 쿼리를 raw SQL로 써야 함), TypeORM(엔티티 데코레이터가 도메인 모델에 섞임) |
| 설정 | zod + `@nestjs/config` | 기동 시 env를 검증하고, brand 타입으로 검증된 값만 흐르게 합니다 | `process.env` 직접 사용, class-validator |
| 입력 검증 | Nest `StandardSchemaValidationPipe` + zod | Nest 12 내장 기능(`@Body({ schema })`)이라 검증과 타입 추론이 한 스키마에서 나옵니다 | class-validator DTO(타입과 검증 규칙을 따로 정의) |
| 오류 응답 | RFC 9457 Problem Details | 표준 형식(`application/problem+json`) + `code`, `errors[]` 확장 | 자체 오류 형식 |
| 테스트 | Vitest · pactum · Testcontainers | 실제 PostgreSQL과 mock 컨테이너로 잠금 · 격리 수준 · 장애를 검증합니다 | Jest, supertest, 메모리 DB 흉내(잠금 · 격리를 재현하지 못함) |
| 린트 · 훅 | oxlint(type-aware) · prettier · husky · lint-staged | ESLint 타입 인식 규칙이 TS7을 지원하지 않습니다. 커밋마다 lint/format, push 전에 typecheck와 전체 테스트를 돌립니다 | ESLint + typescript-eslint |

## 고민한 지점과 되돌린 결정

### 고민한 지점

- **"정확히 한 번"을 어디까지 약속할지.** 외부 API에 멱등 키가 없으니 exactly-once는 불가능합니다. 그래서 목표를 "결과를 모르는 건은 확인하기 전에 재전송하지 않는다"로 낮추고, 확인 대기 시간은 클라이언트 타임아웃이 아니라 서버가 요청을 계속 처리할 수 있는 시간(mock의 최대 지연 30초)에 맞췄습니다. 끝내 확인하지 못한 건은 `FAILED`로 뭉개지 않고 `UNCONFIRMED`로 따로 남겼습니다.
- **우선순위를 어디서 보장할지.** 발송 건을 claim한 뒤 허가를 기다리는 흐름이 더 단순하지만, 그 사이 생긴 긴급 건이 이미 잡힌 대량 건 뒤로 밀립니다. 허가를 먼저 얻는 순서로 바꾸고, 허가가 버려질 수 있는 비용을 받아들였습니다.
- **처리량 한도를 어떤 구간으로 읽을지.** mock은 토큰 버킷처럼 동작했지만 실제 서비스의 한도 방식은 알 수 없어, 가장 엄격한 해석(임의의 1초 구간 50건)을 지키는 GCRA를 택하고 처리량 손실을 동시 발송 수로 메웠습니다.
- **장애 중에 시도 횟수를 언제 쓸지.** 일시 오류(500/503)는 시도로 세지만, 429와 연결 실패는 "보내지 못한 것"이라 시도로 세지 않고 모든 워커가 함께 쉬게 했습니다. 장애가 길어져도 대기 건이 재시도 소진으로 `FAILED`가 되지 않게 하려는 것입니다.
- **port를 얼마나 나눌지.** ISP를 지키려고 port를 쓰임새별로 쪼개면 port 수와 조립 코드가 늘고, 합치면 서비스가 쓰지 않는 메서드까지 받습니다. 개념별 port 하나에 서비스 쪽 `Pick` 선언으로 둘 다 피했습니다.

### 잘못 선택했다가 되돌린 결정

- **연결 실패를 결과 불명으로 두었던 것.** 처음에는 연결 오류를 응답 타임아웃처럼 `UNKNOWN`으로 보냈는데, 발송 API가 내려가 있으면 발송 내역 조회도 실패해 실제로는 나가지 않은 건이 확인 기간 뒤 `UNCONFIRMED`로 끝납니다. 일시 오류로 바꾸는 안도 검토했지만 30초 장애에도 재시도 5회가 소진돼 `FAILED`로 끝나는 것을 확인하고 버렸습니다. 요청이 나가지 않은 것이 확실한 연결 실패만 따로 분류해, 429처럼 공유 제한기를 멈추고 시도 횟수를 쓰지 않게 했습니다.
- **워커 루프 정지 시점.** 처음에는 drain과 같은 종료 단계(`beforeApplicationShutdown`)에서 루프를 멈췄습니다. 같은 단계 안의 순서는 모듈 깊이와 등록 순서로 정해져서, 당시 import 구성에서는 drain이 먼저 실행되어 5초 동안 새 claim이 계속될 수 있었습니다. 실제와 같은 모듈 구성으로 재현한 뒤 루프 정지를 앞 단계(`onModuleDestroy`)로 옮겼습니다.
- **완료 확인 전체 순회.** 처음에는 발송 중인 알림 전체를 한 번에 훑어, 알림이 많으면 종료할 때 그 순회가 끝나기를 기다려야 했습니다. 한 번에 100개만 확인하고 다음 위치를 이어가게 했습니다.
- **마이그레이션을 앱 기동에서 실행했던 것.** api · worker를 여러 개 띄우면 잠금 없는 마이그레이션이 동시에 돈다는 것을 알고 일회성 `migrate`로 분리했습니다.
- **claim 트랜잭션에서만 lease를 확인했던 것.** claim과 요청 시작 기록은 같은 트랜잭션이지만 커밋이 늦어지면 lease가 거의 남지 않은 채 요청을 보낼 수 있어, 요청 직전에 한 번 더 확인하고 부족하면 보내지 않게 했습니다.
- **쓰임새별 저장소 port · 설정 port · 완료 판정 계약.** 발송 건 저장소를 생성 · 발송 큐 · lease 복구 큐 · reconcile 큐 · 취소 · 진행 집계 port 6개로 나눴더니 adapter 하나가 6개를 구현하고 서비스 생성자가 길어졌습니다. 개념별 port 하나와 `Pick`으로 합쳤습니다. 같은 이유로 행위 없는 설정 port 4개는 설정 타입으로, 바깥에서 부르지 않는 완료 판정 계약은 내부 협력자로 바꿨습니다.
- **종류별 `port/in` · `port/out` 폴더.** 목적이 다른 계약이 한 폴더에 섞여, Cockburn 원전의 driving/driven과 `for-<목적>` 이름으로 옮겼습니다.
- **목록 응답 키 `items`.** 범용 키로 시작했다가, 데이터 모델 예시와 같은 `alarms`로 바꿨습니다.
- **문서의 시각 기준.** 처음에는 claim · 복구도 DB 시계로 판정한다고 적었지만, 실제로 DB 시계가 필요한 것은 20ms 단위인 제한기뿐이었습니다. 판정 단위가 30초 이상인 나머지는 워커 시계로 충분하다는 근거와 함께 구현대로 문서를 고쳤습니다.

### 테스트로 보장을 확인한 방법

- 시나리오를 먼저 [SCENARIO.md](SCENARIO.md)에 ID로 정하고, ID를 이름에 단 테스트로 하나씩 Red → Green으로 바꿨습니다.
- 동시성 · 장애 보장은 e2e에서 실제 worker 프로세스(1~3대)와 실제 mock 컨테이너로 확인합니다. "정확히 1번 보냈다"는 DB가 아니라 mock의 발송 내역으로 발송 건마다 셉니다.
- 테스트가 정말 그 보장을 검증하는지, 구현을 일부러 망가뜨려(변이) 실패하는지 확인했습니다. 완료 · reconcile · lease 복구 루프 제거, 우선순위 정렬 반전, 처리량 제한기 해제, 취소 방어선 제거에서 각각 해당 e2e가 실패합니다. 이 과정에서 테스트의 빈틈도 찾았습니다. 긴급 우선 판정을 "첫 긴급 발송과 마지막 긴급 발송 사이에 대량 발송이 없다"로 했더니, 우선순위를 뒤집으면 긴급이 맨 끝에 몰려 오히려 통과했습니다. 지금은 [긴급 알림 우선 처리](#긴급-알림-우선-처리)의 기준으로 판정합니다.
- 발송 중 취소 e2e는 "최종 `SENT` 수 ≤ 취소 시점에 시작된 건 수"로 새 발송이 멈췄는지 봤는데, 취소 직후에는 대기 건이 이미 `CANCELLED`라 "`PENDING`이 아닌 건"을 세면 항상 전체 건수가 나와 아무것도 검증하지 못했습니다. 취소 시점에 남은 대기 건이 실제로 있는지 단언을 더하자 실패했고, 집계에서 `CANCELLED`를 빼서 고쳤습니다.
- 테스트의 시각 비교는 한 시계 안에서만 합니다. 긴급 우선 판정은 mock 발송 시각끼리 비교하고, 기준 시점은 DB의 상태 개수로 잡아 테스트 프로세스와 컨테이너의 시계 차이에 영향받지 않게 했습니다.

## 시간이 더 있다면

- **결과 불명 건 사후 감사와 append-only 시도 이력.** 지금은 현재 상태와 종결 결과만 남아, `SENT`로 확정된 뒤 생긴 중복이나 한 건의 시도 경과가 드러나지 않습니다. 상태 전이마다 한 행을 쌓는 이력 테이블과, 알림 완료 후 `UNKNOWN`을 거친 건만 다시 조회하는 감사 작업을 두겠습니다.
- **제한기가 거절할 때 다음 허가 시각 반환.** 지금은 거절되면 폴링 간격(100ms) 뒤에 다시 묻습니다. 다음 허가 시각만큼만 기다리면 제한기 쓰기와 허가 사이의 빈틈이 함께 줄어듭니다.
- **허가 이후 지연 측정과 오래된 허가 폐기.** 허가를 얻은 뒤 claim과 요청이 늦어지면 실제 요청 간격이 20ms보다 좁아질 수 있습니다. 지연을 주입해 영향을 측정하고, 일정 시간이 지난 허가는 버리게 하겠습니다.
- **lease 부족으로 요청을 시작하지 못한 경우의 시도 횟수 보정.** 요청 시작을 기록한 뒤 직전 확인에서 lease가 부족해 보내지 않은 드문 경우도 지금은 시도 1회로 셉니다.
- **종료 제한 시간을 넘길 때 HTTP 요청을 직접 abort하는 단계.** 지금은 lease를 남긴 채 프로세스를 강제 종료하고 다른 워커가 lease 만료 후 복구합니다. 제한 시간 직전에 진행 중 요청을 abort하고 결과 불명으로 기록하면 lease 만료를 기다리지 않아도 됩니다.
- **수신자 목록 조회 실패 시 확장 lease 즉시 해제.** 지금은 lease 만료(30초) 뒤에 다시 시도됩니다.
- **쿼리 실행 시간 제한.** 연결 대기 제한(5초)만 있고 `statement_timeout` · `lock_timeout`은 없습니다. 느린 쿼리나 잠금 대기에서 루프가 멈추지 않도록 값을 근거와 함께 정하고 통합 테스트로 확인하겠습니다.
- **완료 확인 중복 줄이기.** 지금은 모든 워커가 같은 알림을 확인합니다(결과는 멱등). 워커가 많아지면 advisory lock으로 한 워커만 확인하게 하겠습니다.
- **Pool 종료 책임을 `DatabaseModule`로.** Pool을 만든 모듈이 자기 lifecycle에서 닫으면 종료 조율이 DB를 몰라도 됩니다. drain 뒤에 닫히는 순서를 그대로 보장하는지 확인이 필요합니다.
- **테스트 공용 helper 정리.** 결과 union을 좁히는 helper와 Gate · 고정 시계 같은 fixture가 여러 spec에 흩어져 있습니다.
- **`noUncheckedIndexedAccess` 도입.** 배열 인덱스 접근의 빈 배열 경로를 컴파일러가 잡게 하겠습니다.
- **10만 건 부하 측정(k6).** 대량 발송 중 API 조회 응답 시간과 워커당 동시 발송 수의 적정값을 측정으로 정하겠습니다.
