# 알림 발송 백엔드

API 서버(`api`)가 알림을 만들고 발송을 시작·취소하면, 별도 컨테이너의 발송 워커(`worker`)가 수신자별 발송 건을 외부 발송 API(과제 제공 mock)로 보냅니다.

**기능**

- **대량 알림:** 전체 사용자(약 10만 명)를 사용자 API에서 페이지 단위로 읽어 발송합니다.
- **긴급 알림:** 지정한 1~100명에게 보내며, 대량 알림이 발송 중이어도 먼저 나갑니다.
- **발송 시작 · 취소 · 조회:** 진행 상황은 발송 건 상태별 개수로 봅니다. 취소하면 아직 보내지 않은 건만 멈춥니다.
- **워커 다중화:** `docker compose up --scale worker=3`처럼 늘려도 모든 워커가 초당 50건 한도를 함께 지키고, 같은 수신자에게 중복 발송하거나 누락하지 않습니다. 워커가 중간에 죽어도 다른 워커가 이어받습니다.

- 문서: [SCENARIO.md](SCENARIO.md)(시나리오 ID ↔ 테스트 이름)
- 환경: Node.js 24.21.0, pnpm 10.34.5, Docker Compose v2, PostgreSQL 18, NestJS 12, TypeScript 7, Drizzle ORM 0.45

| 용어                             | 뜻                                                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 알림(`Alarm`)                    | 제목 · 본문 · 종류 · 상태를 가진 발송 단위. 대량 알림(`BULK`)은 전체 사용자, 긴급 알림(`URGENT`)은 지정한 1~100명이 대상                                                  |
| 발송 건(`Delivery`)              | 알림 하나를 수신자 한 명에게 보내는 작업. id를 외부 API의 `clientRef`로 씀                                                                                                |
| 수신자 확장                      | 대량 알림의 수신자를 사용자 API에서 페이지 단위로 읽어 발송 건으로 만드는 단계                                                                                            |
| 발송 허가                        | 모든 워커가 함께 쓰는 rate limiter에서 얻는 1건분의 발송 권한                                                                                                             |
| lease · fencing                  | 워커가 발송 건을 처리하는 동안의 임시 소유권(만료 시각 + `leaseToken`)과, 토큰이 일치할 때만 결과를 저장하게 하는 장치                                                    |
| 결과 불명(`UNKNOWN`) · reconcile | 요청은 보냈지만 응답을 못 받은 상태와, 발송 내역 조회(`GET /v1/messages?clientRef=`)로 결과를 확정하는 단계                                                               |
| `UNCONFIRMED`                    | 확인 기간(`UNCONFIRMED_AFTER_MS`) 안에 결과를 확정하지 못해 재전송 없이 끝낸 종결 상태. `FAILED`와 따로 집계                                                              |
| claim                            | 워커가 발송 가능한 발송 건 1건을 `FOR UPDATE SKIP LOCKED`로 골라 lease를 걸고 가져가는 단계                                                                               |
| rate limiter                     | 모든 워커가 함께 쓰는 처리량 제한기(PostgreSQL 행 하나, GCRA). 초당 50건 한도 안에서 발송 허가를 냄                                                                       |
| backoff · jitter                 | 재시도할수록 대기 시간을 늘리는 방식과, 여러 워커의 재시도가 한 시각에 몰리지 않게 대기 시간에 섞는 무작위 값                                                             |
| cursor                           | 다음 페이지를 이어 읽을 위치. 알림 목록은 `(createdAt, id)`, 수신자 확장은 사용자 API의 다음 페이지 위치                                                                  |
| snapshot                         | 한 트랜잭션의 여러 조회가 같은 시점의 데이터를 보는 것(`REPEATABLE READ`)                                                                                                 |
| readiness · liveness             | `/readyz`는 트래픽을 받아도 되는지(종료 중이거나 DB 장애면 503), `/livez`는 프로세스가 살아 있는지만 알리는 프로브                                                        |
| drain                            | 종료 신호 뒤 readiness를 내리고 로드밸런서가 트래픽을 끊을 때까지 기다리는 시간                                                                                           |
| port · adapter                   | port는 애플리케이션이 바깥과 주고받는 인터페이스(abstract class), adapter는 port를 HTTP · DB · 외부 API 같은 기술에 잇는 구현(controller, repository, HTTP 클라이언트 등) |
| repository · persistence         | repository는 Aggregate를 저장 · 복원하는 port와 그 구현, persistence는 Drizzle로 PostgreSQL에 읽고 쓰는 adapter 묶음                                                      |
| Aggregate                        | 함께 일관성을 지키는 도메인 객체 묶음. 알림 · 발송 건 · 수신자 확장 작업이 각각 하나                                                                                      |
| discriminated union              | `kind`나 `status` 같은 공통 필드 값으로 경우를 나누는 타입. 처리하지 않은 경우를 컴파일러가 잡음                                                                          |
| worker loop                      | 워커 프로세스에서 유스케이스를 반복 호출하는 driving adapter(수신자 확장 · 발송 · reconcile · lease 복구 · 완료 확인)                                                     |
| fake                             | unit 테스트에서 port 대신 쓰는 in-memory 구현. 실제 adapter와 같은 계약 테스트를 통과함                                                                                   |
| composition root                 | port에 adapter를 연결하고 서비스를 조립하는 곳(`src/bootstrap/`과 각 모듈)                                                                                                |

## 1. 실행 방법

### 1-1. Docker Compose

```sh
docker compose up                             # 첫 실행: 이미지 빌드 → 마이그레이션 → api · worker 기동, Ctrl+C로 종료
docker compose up --scale worker=3            # 워커 3대
docker compose up -d                          # 백그라운드 실행
docker compose up --build                     # 코드를 바꾼 뒤 이미지를 다시 빌드해 실행
docker compose down                           # 종료 (데이터까지 지우려면 down -v)
```

- **`docker compose up` 한 번으로 실행됩니다.** 이미지가 없으면 compose가 먼저 빌드하므로 처음에는 `--build`가 필요 없습니다. `--build`는 이미 빌드된 이미지가 있을 때 코드 변경을 반영하려고 다시 빌드하는 옵션입니다.
- **서비스는 계속 떠 있습니다.** 빌드 단계는 타입 검사와 SWC 빌드만 하고 테스트는 돌리지 않습니다(테스트는 [1-3](#1-3-테스트)). 일회성인 `migrate`만 스키마를 적용하고 끝나며, `postgres` · `mock` · `api` · `worker`는 멈출 때까지 실행됩니다.
- **`Ctrl+C`나 `docker compose down`은 graceful shutdown입니다.** 워커는 새 claim을 멈추고 진행 중인 발송 결과를 저장한 뒤 DB를 닫고 exit 0으로 끝납니다. compose는 최대 35초(`stop_grace_period`)까지 기다립니다.
- 기동 순서는 `postgres` healthy → 일회성 `migrate` 성공 → `api` · `worker`입니다. `worker`는 `mock`이 healthy가 될 때까지도 기다립니다.
- 호스트에는 `api`의 3000번 포트만 공개합니다. PostgreSQL과 mock은 compose 내부 네트워크에서만 접근합니다.
- API 문서는 http://localhost:3000/docs (Swagger UI)와 `/docs-json`(OpenAPI 3.0)에 있습니다.
- 데이터는 볼륨 `postgres_data`에 남습니다. 처음 상태로 되돌리려면 `docker compose down -v`를 실행합니다.
- **`api` · `worker`는 비정상 종료되면 다시 뜹니다(`restart: unless-stopped`).** 종료 제한 시간 초과나 기동 시 DB 미준비로 exit 1이 나도 자동으로 복구되고, 워커가 쥐고 있던 발송 건은 lease 만료 뒤 다른 워커(또는 다시 뜬 자신)가 이어받습니다.
- **healthcheck는 readiness(`/readyz`)를 씁니다.** Docker healthcheck는 하나만 둘 수 있고 실패해도 재시작하지 않으므로, `depends_on: service_healthy`가 "트래픽을 받아도 되는 상태"를 기다리도록 readiness를 씁니다. liveness(`/livez`)는 k8s `livenessProbe`처럼 재시작을 결정하는 오케스트레이터용입니다.
- **앱 컨테이너는 최소 권한으로 실행합니다.** `node` 사용자, 읽기 전용 파일시스템(`/tmp`만 tmpfs), 모든 capability 제거, `no-new-privileges`를 적용하고, 대량 발송 중 로그가 디스크를 채우지 않게 json-file 로그를 10MB × 3개로 제한합니다. 공통 설정은 compose의 `x-app-hardening` 하나로 모았습니다.

### 1-2. 로컬 개발

compose와 달리 앱을 호스트에서 직접 띄워 코드 변경을 바로 반영합니다. PostgreSQL과 mock만 컨테이너로 띄웁니다.

**1. 도구 준비** — Node.js 24.21.0과 pnpm 10.34.5가 필요합니다(`mise.toml`에 고정). mise를 쓰면 한 번에 맞춰집니다.

```sh
mise install
```

**2. 의존성 설치**

```sh
pnpm install --frozen-lockfile
```

**3. PostgreSQL과 mock 실행** — compose는 이 둘의 포트를 호스트에 공개하지 않으므로 로컬 개발용으로 따로 띄웁니다.

```sh
docker run -d --name notification-postgres -p 5432:5432 \
  -e POSTGRES_USER=notification -e POSTGRES_PASSWORD=notification -e POSTGRES_DB=notification \
  postgres:18-alpine
docker run -d --name notification-mock -p 4000:4000 ghcr.io/us-all/backend-assignment-api:1.2
```

**4. 환경 변수 지정** — `.env` 파일은 읽지 않으므로 셸에서 지정합니다. 필수는 `DATABASE_URL` 하나이고, 나머지는 아래 표의 기본값으로 동작합니다(`MOCK_API_URL` 기본값이 3번의 mock 주소).

```sh
export DATABASE_URL=postgres://notification:notification@localhost:5432/notification
```

**5. 스키마 적용** — 마이그레이션은 앱 기동과 분리된 일회성 프로세스입니다.

```sh
pnpm db:migrate
```

**6. 실행** — SWC watch로 빌드하고, 코드가 바뀌면 프로세스를 다시 시작합니다.

```sh
pnpm dev          # api(3000) + worker(3001)
pnpm dev:api      # api만
pnpm dev:worker   # worker만
```

`dev:api`와 `dev:worker`는 각자 `dist/`를 다시 빌드하므로 동시에 띄우지 말고, 둘 다 필요하면 `pnpm dev`를 씁니다.

**7. 확인**

```sh
curl localhost:3000/readyz        # 200이면 DB 연결까지 준비됨
open http://localhost:3000/docs   # Swagger UI
```

**8. 정리**

```sh
docker rm -f notification-postgres notification-mock
```

env는 기동 시 zod로 검증하고, 값이 잘못되거나 서로 맞지 않는 조합(예: lease ≤ 요청 타임아웃, 허가 간격 < 21ms)이면 기동하지 않습니다.

| 환경 변수                                                                            | 기본값                                                       | 설명                                                                      |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                       | (필수)                                                       | PostgreSQL 접속 주소                                                      |
| `DATABASE_POOL_MAX`                                                                  | `20`                                                         | 프로세스당 PostgreSQL 연결 수 상한                                        |
| `MOCK_API_URL`                                                                       | `http://localhost:4000`                                      | 외부 발송 API 주소                                                        |
| `DISPATCH_CONCURRENCY`                                                               | `8`                                                          | 워커 프로세스당 동시 발송 루프 수                                         |
| `DISPATCH_MAX_REQUEST_MS` · `DISPATCH_LEASE_MS`                                      | `5000` · `30000`                                             | 외부 API 요청 타임아웃 · 발송 건과 확장 작업의 lease                      |
| `RECONCILE_DELAY_MS` · `UNCONFIRMED_AFTER_MS`                                        | `35000` · `3600000`                                          | 결과 불명 건을 조회하기 전 대기 · 이 기간 안에 확정 못 하면 `UNCONFIRMED` |
| `RETRY_MAX_ATTEMPTS` · `RETRY_BASE_DELAY_MS` · `RETRY_MAX_DELAY_MS`                  | `5` · `1000` · `60000`                                       | 500/503 재시도                                                            |
| `LOOKUP_RETRY_BASE_DELAY_MS` · `LOOKUP_RETRY_MAX_DELAY_MS`                           | `5000` · `60000`                                             | 발송 내역 조회 실패 시 backoff                                            |
| `RATE_LIMIT_INTERVAL_MS`                                                             | `21`                                                         | 발송 허가 간격(21 미만이면 기동 거부). 허가 유효 시간은 이 값의 2배       |
| `USER_PAGE_LIMIT`                                                                    | `1000`                                                       | 수신자 확장 페이지 크기(1~1000)                                           |
| `WORKER_POLL_INTERVAL_MS` · `WORKER_ERROR_DELAY_MS` · `COMPLETION_CHECK_INTERVAL_MS` | `100` · `1000` · `1000`                                      | 할 일이 없을 때 · 오류 뒤 · 완료 확인 한 바퀴 뒤 대기                     |
| `SHUTDOWN_DRAIN_MS` · `SHUTDOWN_TIMEOUT_MS`                                          | `5000` · `25000`                                             | 종료 시 drain 시간 · 제한 시간                                            |
| `HOST` · `PORT` · `LOG_LEVEL` · `LOG_FORMAT`                                         | `0.0.0.0` · API 서버 `3000` / 워커 `3001` · `log` · `pretty` | compose는 `LOG_FORMAT=json`                                               |

### 1-3. 테스트

| 명령                           | 범위                                                                                                                                                                        | 필요 조건 |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `pnpm typecheck` · `pnpm lint` | 타입 검사 · oxlint(type-aware)                                                                                                                                              | 없음      |
| `pnpm test`                    | unit: 도메인, 유스케이스(port는 in-memory fake), worker loop                                                                                                                | 없음      |
| `pnpm test:int`                | integration: Drizzle repository · rate limiter · mock API adapter · 마이그레이션 · 종료 조율 · 워커 프로세스 기동, 이어서 characterization(mock 한도 방식 · 발송 기록 시점) | Docker    |
| `pnpm test:e2e`                | HTTP API 동작(상태 코드 · 응답 형식) · OpenAPI 문서, 실제 워커 프로세스 1~3대로 발송 전체 흐름 · 강제 종료 · 취소 · SIGTERM                                                 | Docker    |

- integration · e2e는 Testcontainers로 실제 PostgreSQL과 mock 컨테이너를 띄웁니다. PostgreSQL은 실행마다 한 번 띄워 마이그레이션한 템플릿 DB를 만들고, 테스트 파일마다 복제한 database를 씁니다. mock은 테스트마다 시나리오에 맞는 설정(`USER_COUNT` · `ERROR_RATE` · `TIMEOUT_RATE` 등)으로 띄웁니다.
- repository 계약 테스트(contract test, `testing/contract/`) 하나를 in-memory fake와 Drizzle adapter 양쪽에 돌려, unit 테스트의 fake가 실제 구현과 똑같이 동작하게 합니다.
- e2e는 "정확히 1번 보냈다"를 DB가 아니라 mock의 발송 내역으로 발송 건마다 셉니다.

#### 부하 테스트 (k6, 선택)

```sh
docker compose up -d                             # 워커 1대
docker compose up -d --scale worker=3            # 워커 3대
pnpm load:test                                   # 기본 RATE=50 (요청/초), DURATION=60s, URGENT_START_AFTER=20s
```

- `load/alarm-api.load.ts`(TypeScript, k6가 직접 실행)를 compose `load` 프로필의 `grafana/k6` 컨테이너로 돌립니다. `docker compose up`만으로는 뜨지 않습니다.
- setup에서 대량 알림을 만들어 발송을 시작하고, 워커가 보내는 동안 `GET /alarms/:id`와 `GET /alarms?limit=20`을 번갈아 일정한 도착률로 호출합니다. teardown에서 발송 중인 알림은 취소합니다.
- 시작 20초 뒤에는 긴급 알림(수신자 100명)을 따로 발송해, 100건의 **첫 요청이 모두 나갈 때까지**(대기 · 발송 중 0건) 걸린 시간(`urgent_all_requested_ms`)을 잽니다. "모두 종결"을 기준으로 하지 않은 것은 응답 없는 약 2%가 `RECONCILE_DELAY_MS`(35초) 뒤에야 확정되어, 우선 처리와 무관하게 35초 이상이 나오기 때문입니다.
- 기준(threshold): 실패율 < 1%, `http_req_duration` p95 < 200ms(전체와 엔드포인트별), check 통과율 > 99%, 긴급 100건 첫 요청 30초 이내.

측정 결과(2026-10-09, 각 1회). 환경: Apple M3 Pro 11코어 · 18GB, macOS 15.6.1, Docker Desktop 29.6.2(VM CPU 11 · 메모리 7.7GB), compose 기본값(워커당 동시 발송 8), mock `1.2` 기본 설정(사용자 10만 명 · 초당 50건 한도 · 일시 오류 약 5% · 타임아웃 약 2%), k6 2.2.0을 같은 compose 네트워크에서 실행. 측정 구간은 발송 시작 직후 60초이고, 허가 간격이 21ms로 바뀌기 전(20ms)에 쟀습니다.

| 구성     | 조회 부하  | API 실패  | API p95 (단건 · 목록) | 초당 발송 수 | 긴급 100건 첫 요청 | 429 |
| -------- | ---------- | --------- | --------------------- | ------------ | ------------------ | --- |
| 워커 1대 | 50 요청/초 | 0 / 3,061 | 25ms (31ms · 14ms)    | 16.1         | 10.9초             | 0   |
| 워커 3대 | 50 요청/초 | 0 / 3,043 | 109ms (142ms · 86ms)  | 14.7         | 7.9초              | 0   |
| 워커 3대 | 2 요청/초  | 0 / 169   | 44ms                  | 13.7         | 8.3초              | 0   |

- **발송 중에도 조회 API는 실패 없이 응답했고, 워커 수와 관계없이 429는 0건이었습니다.** 공유 rate limiter가 워커를 늘려도 합계 한도를 지킨다는 근거입니다.
- **긴급 알림은 대량 발송 중에도 100건이 약 8~11초 안에 모두 나갔습니다.** 긴급 건이 대기하는 동안 허가는 모두 긴급 건에 가므로(E2E-03), 이 시간은 그 시점의 발송 처리량으로 정해집니다.
- **이 60초 구간의 처리량은 워커 수와 무관하게 초당 14~16건이었습니다.** 조회 부하를 거의 없앤 측정(3행)에서도 같아서, 단건 조회의 상태별 집계가 원인은 아닙니다. 수신자 확장 초반 · mock 지연 · 한 대의 노트북에서 모든 컨테이너가 CPU를 나눠 쓰는 환경(측정 중 load average 약 10) 가운데 무엇인지는 확인하지 못했습니다([시간이 더 있다면](#6-시간이-더-있다면)).
- 단일 머신에서 api · worker · DB · mock · k6가 자원을 나눠 쓰므로 운영 환경 수치가 아니라 같은 환경 안의 비교용입니다.

## 2. API 사용법

### 2-1. 엔드포인트

| 메서드 | 경로                   | 설명                                                                                                                 | 성공                    |
| ------ | ---------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| POST   | `/alarms`              | 알림 생성(대량 / 긴급)                                                                                               | 201 알림                |
| GET    | `/alarms`              | 목록(`status` · `kind` 필터, `limit` 1~100 기본 20, `cursor`), 생성 역순                                             | 200 `{ alarms, page }`  |
| GET    | `/alarms/:id`          | 단건(발송 건 상태별 개수 포함)                                                                                       | 200 알림 + `deliveries` |
| POST   | `/alarms/:id/dispatch` | 발송 시작(`DRAFT`만)                                                                                                 | 202 `DISPATCHING` 알림  |
| POST   | `/alarms/:id/cancel`   | 발송 취소(`DRAFT` · `DISPATCHING`만)                                                                                 | 200 `CANCELLED` 알림    |
| GET    | `/livez` · `/readyz`   | liveness(의존성을 보지 않음) · readiness(종료 중이거나 DB가 1초 안에 응답하지 않으면 503). API 서버와 워커 모두 제공 | 200                     |

- 알림 상태는 `DRAFT` → `DISPATCHING` → `COMPLETED`, 그리고 `DRAFT` · `DISPATCHING`에서 `CANCELLED`로만 바뀝니다. 응답에는 그 상태에 해당하는 시각만 들어갑니다(`dispatchedAt` · `completedAt` · `cancelledAt`).
- 목록은 다음 페이지가 있을 때만 `page.nextCursor`가 있습니다.
- OpenAPI 3.0 문서(`/docs-json`)에는 요청 스키마(컨트롤러의 zod 스키마에서 생성)와 성공 응답 스키마, 오류 응답(`ApiProblemResponse.of(status, description)`로 `application/problem+json`과 필수 필드)이 모두 들어 있습니다. e2e가 문서를 OpenAPI 3.0 검증기(`@apidevtools/swagger-parser`)로 검사하고 응답 스키마도 확인합니다.

### 2-2. 요청·응답 예시

아래는 `docker compose up`으로 띄운 서버의 실제 응답입니다(id · 시각은 실행마다 다릅니다).

알림 생성. 대량 알림은 `recipientIds`를 받지 않고, 긴급 알림은 1~100명이 필요합니다.

```sh
curl -X POST localhost:3000/alarms -H 'Content-Type: application/json' \
  -d '{"title":"추석 이벤트 안내","body":"추석 맞이 쿠폰이 도착했습니다","kind":"BULK"}'
curl -X POST localhost:3000/alarms -H 'Content-Type: application/json' \
  -d '{"title":"결제 인증번호","body":"인증번호는 482913 입니다","kind":"URGENT","recipientIds":["u_000001","u_000002"]}'
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

발송 시작(`POST /alarms/:id/dispatch`)은 워커가 비동기로 보내므로 `202`와 `DISPATCHING` 알림을 바로 돌려줍니다. 진행 상황은 단건 조회로 봅니다.

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

단건 조회(`GET /alarms/:id`)는 알림과 발송 건 상태별 개수를 같은 snapshot에서 읽어 돌려줍니다.

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

목록 조회(`GET /alarms?limit=1`). 항목은 생성 응답과 같은 알림 모양입니다.

```json
200 OK
{
  "alarms": [{ "id": "af8abf04-…", "title": "추석 이벤트 안내", "kind": "BULK", "status": "CANCELLED", "…": "…" }],
  "page": { "nextCursor": "MjAyNi0xMC0wOVQwMToxODo0Ni44ODFafGFmOGFiZjA0LWUwZmUtNDQwNS04ODI4LTgwNmQ4N2MxYWVmMw" }
}
```

발송 취소(`POST /alarms/:id/cancel`). 아직 보내지 않은 발송 건은 `CANCELLED`가 되고, 이미 보낸 요청의 결과는 그대로 기록됩니다. 발송 중에 취소하면 `dispatchedAt`도 남습니다.

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

### 2-3. 오류 응답

오류는 RFC 9457 Problem Details(`application/problem+json`)로 응답하고, 원인을 `code`로, 필드별 검증 오류를 `errors[]`로 줍니다. `/livez` · `/readyz`만 k8s 프로브가 기대하는 terminus 형식을 유지합니다.

| 상태 | `code`                  | 상황                                                                                                                           |
| ---- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 400  | `VALIDATION_FAILED`     | 본문 · 경로 · 쿼리 형식 오류, 도메인 규칙 위반(제목 비어 있음, 긴급 수신자 1~100명, 대량 알림에 수신자 지정 등), 잘못된 cursor |
| 404  | `ALARM_NOT_FOUND`       | 없는 알림                                                                                                                      |
| 409  | `ALARM_STATE_CONFLICT`  | 현재 상태에서 할 수 없는 전이(완료된 알림 취소, 발송 중인 알림 다시 발송 등)                                                   |
| 500  | `INTERNAL_SERVER_ERROR` | 예상하지 못한 오류(내부 메시지는 숨기고 로그에만 남김)                                                                         |

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

### 2-4. API 설계 결정

- **상태 변경은 `POST /alarms/:id/dispatch` · `/cancel` 동작 경로로 둡니다.** 허용되는 전이를 서버가 정하고 동작마다 부수효과(발송 건 생성, 대기 건 취소)가 다르기 때문입니다. `PATCH { status }`는 클라이언트가 허용되지 않는 전이를 고를 수 있어 버렸고, 대가로 순수 리소스 모델에서 벗어난 하위 경로가 생겼습니다.
- **발송 시작은 `202 Accepted`입니다.** 요청 시점에 확정되는 것은 "접수"뿐이고, 10만 건 발송을 기다릴 수는 없습니다. 클라이언트는 진행률을 단건 조회로 확인합니다.
- **단건 조회는 알림 상태와 발송 건 집계를 같은 snapshot(`REPEATABLE READ`, `READ ONLY`)에서 읽습니다.** 두 조회가 다른 시점을 보면 `COMPLETED`인데 미종결 건이 남아 보이는 모순이 생깁니다. 대가는 조회마다 `GROUP BY` 집계 1회입니다(`alarm_id`가 앞 열인 unique 인덱스 사용).
- **목록은 offset 대신 `(createdAt, id)` cursor입니다.** 발송 중에도 알림이 생기고 상태가 바뀌어 offset이면 같은 항목이 두 번 나오거나 건너뜁니다. 대가로 임의 페이지로 이동할 수 없고, 페이지 사이의 snapshot은 보장하지 않습니다(`status`로 거르는 중 이미 지나간 위치의 알림 상태가 바뀌면 다음 페이지에 나오지 않음).
- **목록 키는 `alarms`입니다.** 과제의 데이터 모델 예시와 같은 모양입니다. 처음에는 범용 키 `items`를 썼다가 바꿨습니다.
- **오류는 RFC 9457에 `code` · `errors[]`를 더했습니다.** 표준 형식이라 게이트웨이 · 클라이언트가 공통으로 다루고, `code`로 분기합니다. Nest 기본 `{ statusCode, message }`는 분기 기준과 필드별 오류가 없습니다.
- **상태에 해당하는 시각 필드만 응답합니다.** 상태별로 반드시 있는 시각을 discriminated union 타입이 보장해, 모든 시각을 nullable로 두는 것보다 응답 형식이 분명합니다.
- **OpenAPI는 요구 스펙대로 3.0입니다.** `@nestjs/swagger`가 만드는 3.0 문서를 그대로 제공하고 3.1 전용 표현은 쓰지 않습니다.

## 3. 설계 설명

### 3-1. 명세 해석

| 명세                                | 해석                                                                                                                                                                                   |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 대량 알림의 수신자는 "전체 사용자"  | 발송 시작 뒤 사용자 API를 끝까지 읽은 시점의 사용자입니다. 읽는 도중 추가된 사용자는 포함될 수도 있고, 확장이 끝난 뒤 바뀐 목록은 반영하지 않습니다.                                   |
| 긴급 알림은 "먼저 처리"             | 발송 가능한 긴급 발송 건이 있는 동안, 발송 허가를 얻은 요청은 긴급 건을 보냅니다. 이미 나간 대량 요청은 되돌릴 수 없어 예외이고, 재시도 대기 중인 긴급 건은 대량 발송을 막지 않습니다. |
| 긴급 수신자 "최대 100명"            | 중복을 제거한 1~100명입니다. 수신자 없는 긴급 알림은 거부합니다.                                                                                                                       |
| 중복 · 누락이 없어야 함             | 외부 API에 멱등 키가 없어 exactly-once는 불가능합니다. 결과 불명 건은 재전송 대신 발송 내역 조회로 확정해 중복을, lease 만료 복구로 누락을 막습니다([4. 가정과 한계](#4-가정과-한계)). |
| `429`가 "지속적으로" 발생하면 안 됨 | 정상 상황에서는 429가 나지 않게 하는 것이 목표입니다(e2e에서 워커 2 · 3대 모두 0건). 그래도 받으면 `Retry-After`만큼 모든 워커가 함께 멈춥니다.                                        |
| 발송 중 취소                        | 아직 보내지 않은 발송 건만 취소합니다. 이미 나간 요청은 결과대로 `SENT`(또는 `FAILED`)로 남깁니다. 경계는 보내기 직전 확인입니다(4장).                                                 |
| 알림 "완료"                         | 수신자 확장이 끝났고 미종결 발송 건이 없을 때입니다. 끝내 확인하지 못한 `UNCONFIRMED`는 종결로 셉니다.                                                                                 |
| 운영 배포 가정                      | 프로브, 종료 신호 뒤의 정상 종료, 기동 시 설정 검증, JSON 로그, 외부 노출 최소화(API 서버 포트만 공개)를 넣었습니다.                                                                   |

### 3-2. 시스템과 모듈 구조

```text
                    Client ── HTTP :3000 (only published port)
                    │
  ┌─ api ───────────▼──────────────────┐     ┌─ worker ×N ─────────────────────────┐
  │ /alarms REST + OpenAPI             │     │ expansion       users → deliveries  │
  │ /livez /readyz                     │     │ dispatch ×8     permit → claim→send │
  └─────────────────┬──────────────────┘     │ reconcile       UNKNOWN → settle    │
                    │ 1 transaction          │ lease recovery  expired → UNKNOWN   │
                    │ alarm + deliveries     │ completion      settled → COMPLETED │
                    ▼                        └────────┬───────────────────┬────────┘
  ┌─ PostgreSQL ─────────────────────────────────┐    │ SKIP LOCKED       │ HTTP
  │ alarms · deliveries (work queue)             │◀───┘ lease · tokens    ▼
  │ expansion_jobs · rate_limiters (50/s GCRA)   │                ┌─ mock :4000 ─────────────┐
  └──────────────────────────────────────────────┘                │ GET /v1/users            │
                                                                  │ POST · GET /v1/messages  │
                                                                  └──────────────────────────┘
```

`api` · `worker` · `migrate`는 같은 Dockerfile의 다른 target입니다. 코드는 `src/modules/notification/`이 Ports & Adapters 구조이고, `health` 모듈도 같은 배치를 따릅니다. `src/bootstrap/`이 composition root(루트 모듈 · 종료 조율 · OpenAPI), `src/shared/`가 공통 인프라(config · database · http · logging)입니다.

```text
src/modules/notification/
├─ domain/                              순수 TypeScript (Nest · DB · HTTP · zod 의존 없음)
│  ├─ alarm/                            알림 Aggregate
│  ├─ delivery/                         발송 건 Aggregate, 재시도 정책
│  └─ expansion/                        수신자 확장 작업 Aggregate
├─ application/
│  ├─ port/
│  │  ├─ driving/                       바깥이 앱의 기능을 호출하는 인터페이스 (유스케이스마다 하나)
│  │  │  ├─ for-managing-alarms/        생성 · 단건 · 목록 · 발송 시작 · 취소
│  │  │  └─ for-dispatching-alarms/     수신자 확장 · 발송 · reconcile · lease 복구 · 완료 확인
│  │  └─ driven/                        앱이 바깥에 요청하는 인터페이스
│  │     ├─ for-storing-alarms/         알림 repository
│  │     ├─ for-storing-deliveries/     발송 건 repository
│  │     ├─ for-storing-expansion-jobs/ 수신자 확장 작업 repository
│  │     ├─ for-running-transactions/   트랜잭션 실행
│  │     ├─ for-sending-messages/       외부 발송
│  │     ├─ for-looking-up-messages/    외부 발송 내역 조회
│  │     ├─ for-fetching-recipients/    사용자 목록 조회
│  │     ├─ for-permitting-sends/       처리량 제한
│  │     ├─ for-telling-time/           시계
│  │     ├─ for-generating-ids/         id · lease 토큰 생성
│  │     ├─ for-drawing-jitter/         재시도 jitter
│  │     └─ for-checking-shutdown/      워커 종료 여부
│  └─ service/                          port 구현 (일반 클래스, 모듈이 조립)
│     ├─ alarm/                         관리 유스케이스, 응답용 view 변환
│     ├─ delivery/                      발송 · reconcile · lease 복구, 설정 타입
│     ├─ expansion/                     수신자 확장
│     └─ completion/                    완료 확인과 내부 협력자 AlarmCompletionChecker
├─ adapter/
│  ├─ driving/
│  │  ├─ web/                           controller · 요청/응답 schema · presenter
│  │  └─ worker/                        폴링 worker loop
│  └─ driven/
│     ├─ persistence/                   Drizzle 트랜잭션, 개념별 테이블 · repository · PG rate limiter
│     ├─ mock-api/                      외부 발송 · 내역 조회 · 사용자 조회 HTTP 클라이언트
│     ├─ process-state/                 워커 종료 신호 · 요청 중단
│     ├─ system/                        시계 · id · jitter
│     └─ config/                        env → 워커 설정
└─ testing/                             in-memory fake, repository 계약 테스트 (운영 빌드 제외)
```

- **의존은 adapter → application → domain으로만 향합니다.** domain과 application은 Nest · DB · HTTP · zod를 모르고, 서비스는 일반 클래스라 모듈이 `useFactory`로 조립합니다. 핵심 로직을 프레임워크 없이 테스트할 수 있습니다(대가: 모듈의 조립 코드가 길어짐). 이 방향은 리뷰에만 맡기지 않고 oxlint `no-restricted-imports`로 강제합니다(domain · application은 Nest · zod · Drizzle · pg · adapter를, driving adapter는 domain · 서비스 구현을 import하면 lint 오류).
- **port는 `driving` · `driven`으로 나누고 `for-<목적>` 폴더로 묶습니다.** Cockburn은 port를 "목적이 있는 대화"로 보고 `For_doing_something`으로 이름 짓습니다. 이 용어와 Garrido de Paz가 정리한 참조 배치를 따르면 폴더 이름만으로 앱이 바깥과 무엇을 주고받는지 보이고, 같은 목적의 인터페이스와 그 타입(예: `for-sending-messages`의 발송 port와 `SendOutcome`)이 한곳에 모입니다. 처음의 종류별 `port/in` · `port/out`은 목적이 다른 인터페이스 20개 가까이가 한 폴더에 섞였습니다. 폴더 배치는 원전이 강제하지 않는 프로젝트 관례입니다.
- **driving port는 유스케이스마다 하나(abstract class)입니다.** controller와 worker loop는 이 인터페이스와 application이 소유한 readonly 입력 · 결과 타입에만 의존하고 도메인 타입을 import하지 않습니다. hexagonal의 필수 조건이 아닌 일관성을 위한 선택이고, 유스케이스마다 인터페이스 · 타입 파일이 생기는 대가가 있습니다. 입력 · 결과 타입은 유스케이스별 `.type.ts`(쓰기는 `…Command`, 조회는 `…Query`)에 두고, 여러 유스케이스가 함께 쓰는 오류만 `alarm-error.type.ts`에 모읍니다. 처음에는 결과 타입 네 개를 한 파일에 묶어 어느 유스케이스의 결과인지 파일 이름으로 알 수 없었습니다.
- **repository port는 개념마다 하나이고, 서비스는 쓰는 메서드만 `Pick`으로 받습니다.** `AlarmRepositoryPort` · `DeliveryRepositoryPort` · `ExpansionJobRepositoryPort` 세 개를 `TransactionPort.run`이 한 트랜잭션으로 넘기고, 서비스는 콜백 파라미터를 `Pick<…>`으로 좁힌 자기 인터페이스로 선언합니다. 쓰지 않는 메서드는 컴파일러가 막아 ISP를 타입으로 강제하면서 port · adapter 수는 개념 수로 유지합니다. 처음에는 쓰임새별로 나눠 발송 건 저장소만 port 6개였고, adapter 하나가 모두 구현했습니다.
- **같은 목적의 port는 하나로 둡니다.** 알림 id · 발송 건 id · lease 토큰 생성은 `IdGeneratorPort` 하나(`alarmId()` · `deliveryId()` · `leaseToken()`)이고, 서비스는 쓰는 메서드만 `Pick`으로 받습니다. 처음의 생성기 port 3개는 구현이 모두 UUID 생성으로 같아 나눌 이유가 없었습니다.
- **설정은 port가 아니라 서비스가 소유한 readonly 설정 타입입니다.** `DispatchSettings` · `ReconcileSettings` · `ExpansionSettings` 등을 `WorkerSettingsFactory`가 env에서 검증해 만들고 모듈이 생성자로 넘깁니다. 행위 없는 값이라 바꿔 끼울 구현이 없어, 처음의 설정 port 4개를 없앴습니다.
- **완료 판정은 driving port가 아니라 내부 협력자 `AlarmCompletionChecker`입니다.** 바깥에서 직접 부르지 않는 완료 확인 유스케이스의 내부 단계라 port로 드러낼 이유가 없습니다.
- **판단은 엔티티가 하고, 서비스는 시킵니다(Tell-Don't-Ask).** 서비스가 상태를 꺼내 비교하지 않고 `Alarm.isCancelled()` · `requiresExpansion()`, `Delivery.cancelIfWaiting()`, `ExpansionJob.advance()` · `stop()`을 호출합니다. 종결 · 대기 같은 상태 묶음은 `DeliveryStatusPredicates` 한곳에 두어 엔티티와 PostgreSQL repository의 SQL이 같은 정의를 씁니다. 수신자 확장 작업도 처음에는 진행 상태만 담은 데이터였고 전이 규칙이 서비스 쪽 러너에 있었는데, 이를 `ExpansionJob` Aggregate로 옮기고 러너는 확장 서비스에 합쳤습니다.
- **성공과 실패는 예외 대신 `kind` discriminated union입니다.** 외부 발송 결과(`SendOutcome`: accepted · permanent-failure · transient-failure · rate-limited · unreachable · indeterminate)도 port의 타입으로 두어, 처리하지 않은 경우가 있으면 컴파일 오류가 납니다.
- **트랜잭션은 필요한 일관성으로 정합니다.** 여러 변경이 함께 성공해야 하면 `run`, 같은 시점이 필요한 조회는 `readSnapshot`(조회 메서드만 `Pick`한 repository를 넘겨 쓰기를 타입으로 막음)입니다. 변경 추적이 없는 실행기라 Fowler의 Unit of Work와는 범위가 다릅니다.
- **의도한 타협은 하나입니다.** 발송 시작(알림 상태 변경 + 발송 건 또는 확장 작업 생성)과 수신자 확장 페이지(알림 잠금 조회 + 발송 건 생성 + cursor 저장)는 두 Aggregate를 한 트랜잭션에 씁니다. Aggregate 사이는 최종 일관성이 권장되지만(Vernon), "발송 중인데 작업이 없는" 이중 쓰기 불일치를 막으려고 이 두 명령에만 씁니다.
- **in-memory fake는 모듈의 `testing/`에 둡니다.** 같은 계약 테스트를 fake와 Drizzle adapter에 함께 돌려 fake가 실제처럼 동작함을 보장하고, 운영 빌드에서는 제외합니다.

### 3-3. 스키마

마이그레이션은 [`drizzle/`](drizzle)의 순서 있는 SQL(`0000` ~ `0005`)이고, 시드 데이터 없이 빈 DB에서 재현됩니다(rate limiter 행은 첫 허가 때 생성). 빈 DB에 적용 · 재적용을 통합 테스트로 확인하고, 모든 통합 · e2e 테스트도 빈 템플릿 DB에 마이그레이션한 뒤 실행합니다.

| 테이블           | 역할                                                                                                  | 키 · 제약                                                                                                                                                                                                                                                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `alarms`         | 제목 · 본문 · 종류 · 긴급 수신자 목록 · 상태와 전이 시각                                              | PK `id`(uuid, 앱에서 생성), CHECK 종류 · 상태                                                                                                                                                                                                                                                                              |
| `deliveries`     | 수신자 1명에 대한 발송 1건의 상태 · 시도 횟수 · lease · 재시도 · reconcile · 결과. **작업 큐를 겸함** | PK `id` = 외부 API `clientRef`. **UNIQUE(`alarm_id`, `recipient_id`)**: 확장 페이지를 다시 읽어도 `ON CONFLICT DO NOTHING`으로 중복 없음. CHECK: 상태별 필수 열(`SENT`면 `message_id` · `sent_at`, `IN_FLIGHT`면 `lease_token` · `lease_expires_at` 등). `priority_rank`는 `priority`에서 계산되는 생성 열(긴급 0, 대량 1) |
| `expansion_jobs` | 대량 알림의 사용자 목록 cursor · 진행 상태(`IN_PROGRESS` · `COMPLETED` · `STOPPED`) · 확장 lease      | PK이자 FK `alarm_id`(알림당 하나), CHECK: 진행 중이면 cursor 필수                                                                                                                                                                                                                                                          |
| `rate_limiters`  | 모든 워커가 함께 쓰는 rate limiter: GCRA의 다음 허가 시각 · 정지 시각                                 | PK `name`                                                                                                                                                                                                                                                                                                                  |

- **상태별 필수 열을 CHECK로 강제합니다.** 도메인의 상태는 상태별로 필요한 값만 가진 discriminated union이고, DB에서는 `status`와 상태별 열로 펼칩니다. 매퍼 실수나 도메인을 거치지 않은 쓰기가 있어도 불가능한 조합이 저장되지 않습니다(대가: 상태가 늘면 마이그레이션 필요).
- **발송 건 id를 `clientRef`로 보냅니다.** 발송 건과 외부 발송 내역이 1:1로 연결되어, 응답을 못 받은 건을 이 값으로 조회합니다.
- **정보 보존:** 행을 지우는 경로가 없습니다(삭제 API 없음, 취소는 상태만 바꿈, FK `ON DELETE NO ACTION`). 알림 내용은 생성 후 바꾸지 않고, 대량 알림의 수신자는 확장 시점의 사용자로 고정합니다. 종결 상태는 결과를 남깁니다(`SENT`는 messageId · 발송 시각 · 같은 `clientRef` 중복 건수, `FAILED`는 사유, `UNCONFIRMED`는 결과 불명이 시작된 시각, `attempts`는 요청 시작 횟수). 한 건의 중간 경과와 시도별 응답은 현재 상태 열을 덮어써 남지 않습니다.
- **인덱스:** 대기 건 조회는 모두 상태별 부분 인덱스라 종결된 행이 쌓여도 비용이 커지지 않습니다. 발송 건 10만 건에서 claim · reconcile · lease 복구 쿼리가 Index Scan을 쓰는 것을 `EXPLAIN`으로 확인했습니다(읽은 buffer 1~4).

  | 인덱스                                                                                              | 쓰임                              |
  | --------------------------------------------------------------------------------------------------- | --------------------------------- |
  | `deliveries_claimable_idx (priority_rank, created_at, id) WHERE status IN ('PENDING','RETRY_WAIT')` | claim: 긴급 먼저 → 오래된 것 먼저 |
  | `deliveries_reconcilable_idx (reconcile_at, id) WHERE status = 'UNKNOWN'`                           | 확인 시각이 지난 결과 불명 건     |
  | `deliveries_leased_idx (lease_expires_at, id) WHERE status = 'IN_FLIGHT'`                           | lease가 만료된 건(멈춘 워커의 건) |
  | `deliveries (alarm_id, recipient_id)` UNIQUE                                                        | 알림별 상태 집계 · 미종결 수      |
  | `alarms_created_at_id_idx (created_at, id)`                                                         | 목록 cursor                       |
  | `expansion_jobs_claimable_idx (enqueued_at, alarm_id) WHERE status = 'IN_PROGRESS'`                 | 진행 중인 확장 작업               |

### 3-4. 발송 처리 흐름 (발송 시작 → 수신자 확장 → 허가 → claim → 발송 → 결과 기록 → reconcile → 완료)

외부 HTTP 호출은 항상 트랜잭션 밖에서 합니다. 요청 동안 행 잠금과 DB 연결을 붙잡지 않기 위해서입니다.

1. **발송 시작(API 서버):** 알림을 잠그고 `DISPATCHING`으로 바꿉니다. 같은 트랜잭션에서 긴급 알림이면 수신자별 발송 건을, 대량 알림이면 확장 작업을 만듭니다. 10만 건을 요청 안에서 만들지 않으므로 바로 202로 응답합니다.
2. **수신자 확장:** 확장 루프가 확장 작업 하나를 lease로 잡고, 트랜잭션 밖에서 사용자 API 1,000명 페이지를 읽은 뒤, 한 트랜잭션에서 알림이 아직 발송 중인지 확인 → 발송 건 생성 → 다음 cursor 저장을 합니다. 워커가 죽으면 lease 만료 뒤 다른 워커가 마지막 커밋 cursor부터 이어받고, 취소된 알림은 다음 페이지에서 확장을 멈춥니다.
3. **허가:** 발송 루프는 먼저 공유 rate limiter에서 발송 허가를 얻습니다. 못 얻으면 claim하지 않고 쉽니다. 종료가 요청된 뒤라면 허가를 얻었어도 claim하지 않고 `stopped`로 끝납니다. claim하는 사이 종료가 요청됐으면 보내지 않고 `leaseToken`이 그대로일 때만 시도 횟수를 되돌려 `PENDING`으로 반납합니다.
4. **claim:** 그 순간 발송 가능한(`PENDING` 또는 재시도 시각이 지난 `RETRY_WAIT`) 건 중 최우선 1건을 `FOR UPDATE SKIP LOCKED`로 잡아 새 `leaseToken`과 lease를 걸고 요청 시작을 기록합니다. 알림이 취소됐으면 그 건을 `CANCELLED`로 바꿉니다.
5. **발송:** 보내기 직전 알림을 공유 잠금(`FOR SHARE`)으로 다시 읽어, claim 커밋 뒤 취소됐으면 보내지 않고 `leaseToken`이 그대로일 때만 시도 횟수를 되돌려 `CANCELLED`로 바꿉니다. 허가를 요청한 지 허가 유효 시간(허가 간격 × 2, 기본 42ms)이 지났으면 허가를 한 번 새로 얻고, 못 얻으면 보내지 않고 `leaseToken`이 그대로일 때만 시도 횟수를 되돌려 `PENDING`으로 반납합니다(3-6). 남은 lease가 요청 타임아웃보다 짧으면 보내지 않고, `leaseToken`이 그대로일 때만 시도 횟수를 되돌려 `PENDING`으로 반납합니다(claim 커밋이 늦어질 수 있어 직전에 다시 확인). 요청은 `clientRef` = 발송 건 id, 5초 타임아웃입니다.
6. **결과 기록:** `leaseToken`과 상태가 그대로일 때만 저장합니다(fencing). 202 → `SENT`, 400 → `FAILED`, 500/503 → backoff 후 `RETRY_WAIT`, 429 · 연결 실패 → rate limiter 정지 + 시도 횟수를 쓰지 않는 `RETRY_WAIT`, 타임아웃 · 요청 후 연결 끊김 → `UNKNOWN`. 그 사이 알림이 취소됐고 재시도할 건이면 `CANCELLED`로 둡니다. 이때 알림을 공유 잠금(`FOR SHARE`)으로 읽어, 커밋 전인 취소가 있으면 그 커밋을 기다린 뒤 판단합니다(잠금 없이 읽으면 취소가 대기 건을 정리한 직후 `RETRY_WAIT`가 저장돼 취소된 알림에 대기 건이 남습니다). 잠금 순서는 취소와 같은 알림 → 발송 건이라 교착이 생기지 않습니다.
7. **reconcile:** 확인 시각(마지막 요청 시작 또는 lease 만료 + `RECONCILE_DELAY_MS`)이 지난 `UNKNOWN` 1건을 고르면서 확인 시각을 `DISPATCH_LEASE_MS`만큼 미뤄 다른 워커가 같은 건을 조회하지 않게 합니다(조회 중 워커가 죽으면 그만큼 뒤 다시 대상이 됨). 발송 내역이 있으면 `SENT`, 없으면 최대 시도 안에서 `RETRY_WAIT`(알림이 취소됐으면 `CANCELLED`, 결과 기록과 같이 알림을 공유 잠금으로 읽음), 조회 실패면 backoff 후 재조회, 확인 기간이 지나면 `UNCONFIRMED`로 종결합니다. 확정은 확인 시각 · 조회 실패 횟수가 그대로일 때만 저장합니다. 별도 루프가 lease가 만료된 `IN_FLIGHT`를 `UNKNOWN`으로 넘겨 같은 경로로 확정합니다.
8. **완료:** 완료 확인 루프가 발송 중인 알림을 100개씩 훑으며, 알림마다 잠그고 `AlarmCompletionChecker`가 "확장 완료 여부"와 "미종결 발송 건 수"를 넘겨 알림이 스스로 `COMPLETED`를 판단합니다. 결과가 확정될 때마다 하면 10만 명 알림 하나에서 미종결 집계가 10만 번 돌아 주기적으로 합니다(대가: 완료 표시가 한 바퀴 + 1초만큼 늦을 수 있음).

```text
Delivery  PENDING ─claim─▶ IN_FLIGHT ─202──────────────────────▶ SENT
             ▲                │ ─400───────────────────────────▶ FAILED
             │                │ ─500/503/429/unreachable─▶ RETRY_WAIT ─(due, claim)─▶ IN_FLIGHT
             │                │ ─timeout/lease expired─────────▶ UNKNOWN
             └────────────────┘ (not sent: stale permit · shutdown · lease too short → release)
          UNKNOWN ─found─▶ SENT │ ─none─▶ RETRY_WAIT · FAILED · CANCELLED
                  ─lookup failed─▶ UNKNOWN (backoff) │ ─confirm window passed─▶ UNCONFIRMED
          PENDING · RETRY_WAIT ─cancel─▶ CANCELLED
          IN_FLIGHT (request not started) ─alarm cancelled─▶ CANCELLED
```

워커 프로세스는 모두 대칭이고 리더가 없습니다. 각 워커가 확장 1 · 발송 `DISPATCH_CONCURRENCY`(8) · reconcile 1 · lease 복구 1 · 완료 확인 1개의 루프를 돌리고, 루프는 일을 했으면 바로, 할 일이 없으면 100ms 뒤, 오류면 로그를 남기고 1초 뒤 다시 실행합니다.

### 3-5. 워커 간 작업 분배

- **PostgreSQL 단독이고 `deliveries` 테이블이 곧 작업 큐입니다.** 알림 상태 변경과 작업 생성이 함께 성공해야 하는데, 브로커를 두면 두 저장소에 나눠 쓰는 이중 쓰기가 생깁니다. 다중 워커의 동시성 · 장애 복구 · 처리량 공유도 저장소 하나로 설명됩니다. 대안은 Redis(BullMQ), RabbitMQ · Kafka + outbox였고, 대가로 지연 큐 같은 큐 기능을 직접 만들고 폴링 비용과 DB 단일 병목을 감수합니다.
- **`FOR UPDATE SKIP LOCKED`로 1건씩 claim합니다.** 워커 수와 관계없이 서로 다른 건을 잠금 대기 없이 가져가고, 워커별 파티션 할당처럼 대수가 바뀔 때 재분배할 필요가 없습니다. 대가는 1건마다 트랜잭션 1회라 배치 claim보다 DB 왕복이 많다는 점입니다.
- **lease와 claim마다 새 `leaseToken`(fencing)을 씁니다.** 워커가 죽어도 lease 만료 후 다른 워커가 이어받고, 늦게 깨어난 워커의 결과 저장은 토큰 불일치로 거부됩니다. 요청 동안 행 잠금을 유지하면(트랜잭션 안에서 HTTP) 연결이 묶이고, 하트비트 연장은 복잡도에 비해 이득이 작아 택하지 않았습니다. 대가로 죽은 워커의 건은 lease 만료(30초) + reconcile 지연(35초)만큼 늦게 확정됩니다.
- **수신자 확장은 페이지마다 커밋합니다.** 발송 시작 요청에서 10만 건을 만들면 응답이 늦고, 전체를 한 번에 저장하면 중간 실패 시 처음부터 다시 해야 합니다. 대가로 확장과 발송이 동시에 진행되어 확장이 끝나기 전에는 총 건수가 계속 늘어 보입니다.
- **모든 워커가 같은 루프를 대칭으로 실행합니다.** 리더 선출 없이 한 대가 죽어도 남은 워커가 그대로 이어받습니다. 대가는 모든 워커가 같은 알림의 완료 확인을 중복 수행한다는 점입니다(결과는 멱등).

### 3-6. 처리량 제한 준수

- **공유 rate limiter는 PostgreSQL 행 하나입니다.** 초당 50건은 워커 전체 합계라 공유 상태가 필요하고, 원자적 `INSERT … ON CONFLICT DO UPDATE … WHERE … RETURNING` 한 문장으로 허가를 냅니다. 워커마다 50/N으로 나누면 대수가 바뀔 때마다 재설정해야 하고 쉬는 워커 몫이 낭비되며, Redis는 인프라가 늘어납니다. 대가는 허가 1개마다 DB 쓰기 1회입니다.
- **GCRA로 burst 없이 21ms 간격으로 허가합니다.** 용량 50, 초당 50개 보충인 일반 토큰 버킷은 가득 찬 상태에서 첫 1초에 최대 100건이 나가므로, **임의의 1초 구간**에서 50건 이하를 지키려고 간격을 고르게 띄웁니다. 대가로 늦게 나간 허가를 만회하지 않아, 동시 요청자가 적으면 한도보다 느립니다(같은 환경에서 동시 발송 3개 약 75%, 6개 약 88%, 20개 약 95%). 처리량은 워커 대수와 `DISPATCH_CONCURRENCY`로 맞춥니다.
- **오래된 허가로는 보내지 않습니다.** rate limiter가 보장하는 것은 허가 발급이 임의의 1초 구간에서 50건 이하라는 것까지입니다(DB-11). 허가 뒤 claim이 늦어지면 오래된 허가의 요청이 그 뒤 허가들의 요청과 몰려, 허가 간격을 모두 지켰는데도 실제 요청이 1초 구간에 50건을 넘을 수 있습니다. 그래서 보내기 직전에 허가를 요청한 시각부터 지난 시간이 허가 유효 시간(허가 간격 × 2, 기본 40ms)을 넘으면 허가를 한 번 새로 얻고, 못 얻으면 보내지 않고 반납합니다(UC-25). 잡은 건을 놓지 않고 새 허가를 시도하므로 긴급 건이 대량 건 뒤로 밀리지 않고, 반납한 건은 다음 허가에서 다시 우선순위대로 claim됩니다. 경과 시간은 워커 시계로 허가 요청 직전부터 재서(실제 발급은 그 뒤) DB와 워커의 시계 차이에 영향받지 않고 실제보다 짧게 재지 않습니다.
  - **보장:** 요청은 자기 허가 발급 뒤 허가 유효 시간 안에 시작하므로, 임의의 1초 구간에 시작한 요청의 허가는 길이 1,000ms + 유효 시간 구간 안에 있습니다. 기본 21ms 간격이면 ⌈1,042 / 21⌉ = **50건**이라 허가 발급뿐 아니라 **요청 시작 기준으로도 임의의 1초 구간 50건 이하**입니다. 대가로 처리량 상한은 초당 50건이 아니라 약 47.6건입니다(20ms면 요청 기준 최대 52건이 되어 21ms를 기본값이자 최소값으로 둡니다). 요청 시작부터 외부 API 도착까지의 네트워크 지연 차이는 범위 밖입니다.
- **허가 시각은 DB 시계(`clock_timestamp()`)로 판정합니다.** 21ms 간격이라 워커 사이의 ms 단위 시계 차이도 한도 초과로 이어질 수 있습니다. claim · lease 복구 · reconcile은 판정 단위가 30초 이상이라 워커 시계(`ClockPort`, NTP 동기화 가정)로 충분합니다.
- **429를 받으면 `Retry-After`만큼 rate limiter를 정지합니다.** 한 워커가 받은 429를 모든 워커가 함께 존중해야 429가 이어지지 않습니다. 더 짧은 `Retry-After`로 정지 시각을 앞당기지 않습니다.
- **mock의 한도 방식은 따로 측정했습니다.** 60건 동시 전송 시 52건 성공, 소진 직후 경과 시간 × 50/s만큼 성공, 벽시계 초 경계와 관계없이 약 150ms 만에 다시 성공, `Retry-After`는 매번 `1`로 토큰 버킷(용량 약 50)과 맞았습니다. 특성 테스트(EXT-10)는 우리 rate limiter를 거친 부하(동시 발송 20개)에서 2초 동안 429가 없고 한도의 80% 이상 성공하는지 확인합니다.

### 3-7. 긴급 알림 우선 처리

- **발송 허가를 먼저 얻고, 그 순간 최우선 1건을 claim해 바로 보냅니다.** 발송 건을 claim해 둔 채 허가를 기다리면 그 사이 생긴 긴급 건이 이미 잡힌 대량 건 뒤로 밀립니다. 긴급 전용 큐 · 워커를 나누면 공유 한도를 나눠야 합니다. 대가로 허가를 얻었는데 보낼 건이 없으면 그 허가는 버려집니다(한도를 넘지는 않음).
- **우선순위는 생성 열 `priority_rank`(긴급 0, 대량 1) 하나로 정합니다.** claim 정렬과 부분 인덱스가 같은 `(priority_rank, created_at, id)` 순서라, 대기 건이 10만 건이어도 최우선 1건을 인덱스 첫 항목으로 찾습니다. 우선순위 규칙을 바꾸려면 생성식과 인덱스만 바꾸면 되지만, 그 자체는 마이그레이션이 필요합니다.
- **재시도 대기 중인 긴급 건은 대량 발송을 막지 않습니다.** 재시도 시각 전의 긴급 건 때문에 허가를 비워 두면 공유 한도만 낭비됩니다.
- e2e(E2E-03)는 대량 발송 중 긴급 알림을 시작해, "긴급 발송을 시작한 시점에 이미 시작된 대량 건 + 동시 발송 수"를 넘는 대량 발송이 마지막 긴급 발송보다 먼저 나가지 않았는지 mock 발송 내역으로 판정합니다.
  - 여유분을 동시 발송 수(`DISPATCH_CONCURRENCY` × 워커 수, 이 e2e는 워커 1대)만큼 두는 이유는, 긴급 건이 커밋되는 순간 이미 허가를 얻고 claim 조회를 시작한 발송 루프가 루프마다 최대 1건의 대량 건을 잡아 보낼 수 있기 때문입니다. 그 뒤의 claim은 모두 긴급 건을 먼저 고릅니다.

### 3-8. 장애 대응

| 패턴                           | 적용                                                                                                                                                                                                                                                                                                                       | 왜                                                                                                                                                                             |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 처리량 제한                    | PostgreSQL 공유 GCRA rate limiter, 모든 워커 합계 초당 50건                                                                                                                                                                                                                                                                | mock이 한도를 넘으면 429                                                                                                                                                       |
| 요청 타임아웃                  | 발송 · 발송 내역 조회 · 사용자 목록 요청마다 `AbortSignal.timeout(5s)`. lease보다 짧아야 기동                                                                                                                                                                                                                              | mock은 일부 요청에 30초 동안 응답하지 않아 발송 슬롯이 묶임                                                                                                                    |
| 재시도 + 지수 backoff + jitter | 500/503은 1초부터 2배씩 최대 60초, 최대 5회. 조회 실패는 5초부터 최대 60초로 `UNCONFIRMED_AFTER_MS`(1시간)까지. 지연은 계산값의 50~100% 사이 무작위                                                                                                                                                                        | 500/503은 "발송되지 않음"이 보장되어 재전송이 안전하고, jitter는 워커들의 재시도가 한 시각에 몰리지 않게 함                                                                    |
| 공유 정지(서킷 브레이커 역할)  | 429는 `Retry-After`만큼, 발송 API에 연결 자체를 못 하면(연결 거부 · 주소 해석 실패) 5초 동안 rate limiter를 멈춰 모든 워커가 함께 쉼. 연결 실패 건은 시도 횟수를 쓰지 않고 `RETRY_WAIT`(`UNREACHABLE`). 정지가 끝나면 허가가 다시 20ms 간격으로 한 건씩 나가 첫 요청이 시험 요청 역할을 하고, 또 실패하면 곧바로 다시 멈춤 | 응답하지 않는 서비스에 요청을 쏟지 않고, 장애가 길어도 대기 건을 시도 소진으로 `FAILED` 처리하지 않음. 연결조차 안 된 요청은 나가지 않은 것이 확실해 결과 불명으로 보내지 않음 |
| 재전송 대신 reconcile          | 타임아웃 · 요청 후 연결 끊김 · lease 만료는 `UNKNOWN`으로 두고 확인 시각 이후 `clientRef`로 조회                                                                                                                                                                                                                           | mock은 중복을 막지 않으므로 결과를 모르는 건을 바로 재전송하면 중복 발송                                                                                                       |
| 종결 상태 `UNCONFIRMED`        | 확인 기간 안에 확정하지 못하면 재전송 없이 종결, `FAILED`와 따로 집계                                                                                                                                                                                                                                                      | 알림이 끝나지 않는 일을 막고, 실제로 나갔을 수 있는 건을 운영 확인 대상으로 남김                                                                                               |

**오류율 기반 서킷 브레이커는 두지 않았습니다.** mock의 5xx는 요청의 약 5%에서 무작위로 나는 일시 오류라 지수 backoff로 흡수되고, 오류율로 회로를 열면 정상 요청까지 막아 처리량만 줄어듭니다. 서킷 브레이커가 막으려는 "응답하지 않는 서비스에 계속 요청하는" 상황은 연결 실패 공유 정지와 요청 타임아웃이, 과부하 신호는 429 공유 정지가 맡습니다. 실제 서비스에서 지속적인 5xx가 관측되면 같은 rate limiter 정지에 오류율 조건을 더할 수 있습니다.

| 중복 · 누락 상황                   | 처리                                                                                                                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 같은 수신자의 발송 건이 두 번 생김 | UNIQUE(`alarm_id`, `recipient_id`) + `ON CONFLICT DO NOTHING`                                                                                                                      |
| 워커 두 대가 같은 건을 가져감      | `FOR UPDATE SKIP LOCKED` + lease                                                                                                                                                   |
| lease를 잃은 워커의 늦은 결과      | 토큰과 상태가 일치할 때만 저장(fencing)                                                                                                                                            |
| 두 워커가 같은 결과 불명 건을 조회 | 고를 때 확인 시각을 미뤄 예약, 확정은 조건부 저장                                                                                                                                  |
| 확장 · 발송 중 워커 종료           | 늦는 요청은 abort해 `UNKNOWN`으로 저장. 강제 종료된 건은 lease 만료 후 다른 워커가 cursor부터 이어받거나 `UNKNOWN`으로 복구해 조회로 확정(재전송 없음)                             |
| 발송 중 취소                       | 대기 건을 한 번에 `CANCELLED`로, claim · 보내기 직전 · 결과 저장 때도 알림 상태 재확인(보내기 직전과 결과 저장은 `FOR SHARE`로 취소 커밋을 기다림). 이미 나간 요청은 결과대로 기록 |

### 3-9. 운영 구성과 종료

- **마이그레이션은 별도 일회성 `migrate` 엔트리포인트 · 컨테이너입니다.** 앱 기동 때 하면 API 서버 · 워커 여러 개가 동시에 실행하는데 Drizzle의 `migrate()`는 잠금을 잡지 않습니다. advisory lock으로 감싸는 대안보다 단계를 분리하는 쪽이 단순하고, compose가 순서를 보장합니다.
- **`/livez`와 `/readyz`를 나눕니다.** liveness가 DB를 보면 DB 장애 때 멀쩡한 프로세스까지 재시작됩니다.
- **기동할 때 DB에 한 번 연결해 봅니다.** pg Pool은 첫 쿼리 때 연결하므로, 그대로 두면 DB 주소가 틀려도 API 서버 · 워커가 떠서 readiness만 503을 내거나 워커 루프가 오류 로그만 반복합니다. `DatabaseModule`의 `onModuleInit`에서 `SELECT 1`(연결 대기 최대 5초)이 실패하면 `failed to start: database is unreachable at startup: …`을 남기고 exit 1로 끝납니다(`migrate` 포함, DB-22).
- **연결 수는 `DATABASE_POOL_MAX`(20)로 정합니다.** 워커 한 프로세스가 루프 12개(발송 8 + 4)를 돌려 pg 기본값 10이면 연결을 기다리는 루프가 생깁니다. 대가로 (워커 대수 + API 서버) × 20이 PostgreSQL `max_connections`(기본 100)를 넘지 않게 조정해야 합니다.
- **종료는 Nest lifecycle 단계에 나눠 둡니다.** 같은 단계 안의 순서는 모듈 깊이와 등록 순서에 좌우되므로, 앞뒤가 중요한 일은 서로 다른 단계에 둡니다.
  1. 종료 신호를 받는 즉시 readiness를 내리고, 제한 시간(`SHUTDOWN_DRAIN_MS` + `SHUTDOWN_TIMEOUT_MS`)을 재는 감시 타이머를 시작합니다.
  2. `onModuleDestroy`: 워커는 종료 플래그를 먼저 세운 뒤 루프를 멈춥니다. 발송 유스케이스는 허가를 얻은 직후 이 플래그를 확인해 새 발송 건을 claim하지 않고, 진행 중인 요청과 결과 저장을 기다립니다. `SHUTDOWN_TIMEOUT_MS`의 절반이 지나도 루프가 멈추지 않으면 진행 중인 외부 HTTP 요청을 abort합니다. 중단된 발송은 발송됐을 수 있으므로 결과 불명(`UNKNOWN`)으로 저장해 재전송하지 않고 reconcile로 확정하고, 발송 내역 조회와 사용자 조회는 실패로 처리해 다음에 다시 시도합니다. 나머지 절반은 결과 저장과 DB 종료에 씁니다. 기본값에서는 요청 제한 시간(`DISPATCH_MAX_REQUEST_MS`, 5초)이 먼저 끝나 abort가 일어나지 않고, 제한 시간을 요청 제한 시간보다 짧게 둔 배포에서 동작합니다. 별도 설정 없이 제한 시간에서 나눠 두 값이 어긋나지 않게 했습니다.
  3. `beforeApplicationShutdown`: drain 시간만큼 기다려 로드밸런서가 트래픽을 끊을 시간을 줍니다.
  4. `onApplicationShutdown`: Pool을 만든 `DatabaseModule`이 DB 연결을 닫고 exit 0으로 끝납니다. 전역 모듈의 hook은 이 단계의 마지막에 실행되므로 다른 모듈의 종료 작업이 모두 끝난 뒤에 닫힙니다. 감시 타이머는 Pool이 닫힌 뒤에 해제해, 반납되지 않은 연결 때문에 Pool 종료가 끝나지 않아도 강제 종료가 동작합니다.
  5. 요청을 중단한 뒤에도 제한 시간 안에 끝나지 않으면 exit 1로 강제 종료합니다. 결과를 저장하지 못한 건은 lease를 가진 채 남고, lease 만료 후 다른 워커가 `UNKNOWN`으로 복구해 조회로 확정합니다. 끝나지 않는 작업 때문에 종료가 늘어지지 않게 하는 대신, 그 건의 확정이 늦어집니다.
- compose의 `stop_grace_period`(35초)는 drain + 제한 시간(30초)보다 깁니다. 종료 타이머 값과 그 합은 Node 타이머 상한(2,147,483,647ms) 이하로 검증합니다. 상한을 넘으면 Node가 1ms로 실행해 기동 직후 강제 종료되기 때문입니다.

### 3-10. 기술 선택

| 영역               | 선택                                                        | 이유                                                                                                                      | 검토한 대안                                                                    |
| ------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 언어 · 프레임워크  | TypeScript 7 · NestJS 12                                    | 모듈 · DI · lifecycle로 API 서버와 워커를 같은 구조로 조립. TS7(tsgo)은 타입 검사가 빠름                                  | TS 5.x                                                                         |
| 빌드 · 테스트 변환 | SWC                                                         | TS7에는 compiler API가 없어 Nest CLI(tsc) 빌드를 쓸 수 없음. 빌드 · watch · 테스트 변환은 SWC, 타입 검사는 `tsc --noEmit` | Nest CLI + tsc, webpack                                                        |
| 저장소 · 큐        | PostgreSQL 18                                               | 상태와 작업 큐를 한 트랜잭션에, `SKIP LOCKED` · 부분 인덱스 · CHECK · 생성 열                                             | Redis · 메시지 브로커 추가(3-5)                                                |
| DB 접근            | Drizzle ORM 0.45                                            | 코드 생성 없는 순수 TS, `FOR UPDATE SKIP LOCKED` · `ON CONFLICT … WHERE`를 그대로 표현, SQL 마이그레이션 생성             | Prisma(잠금 쿼리를 raw SQL로), TypeORM(엔티티 데코레이터가 도메인 모델에 섞임) |
| 설정 · 입력 검증   | zod + `@nestjs/config`, Nest `StandardSchemaValidationPipe` | 기동 시 env 검증과 brand 타입, 요청 검증과 타입 추론을 한 스키마에서                                                      | class-validator(타입과 규칙을 따로 정의)                                       |
| 테스트             | Vitest · pactum · Testcontainers                            | 실제 PostgreSQL과 mock 컨테이너로 잠금 · 격리 수준 · 장애를 검증                                                          | Jest, supertest, 메모리 DB 흉내(잠금 · 격리 재현 불가)                         |
| 린트 · 훅          | oxlint(type-aware) · prettier · husky · lint-staged         | ESLint 타입 인식 규칙이 TS7을 지원하지 않음. 커밋마다 lint/format, push 전에 typecheck와 전체 테스트                      | ESLint + typescript-eslint                                                     |

## 4. 가정과 한계

- **reconcile 대기 시간은 서버 쪽 근거로 정합니다.** 클라이언트가 요청을 끊어도 서버는 이미 받은 요청을 계속 처리할 수 있습니다. mock 명세의 "타임아웃 건은 발송은 처리되고 응답만 최대 `TIMEOUT_MS`(30초) 늦게 온다"에 맞춰 `RECONCILE_DELAY_MS`(35초)를 그보다 길게 두고, "발송 내역이 응답보다 먼저 기록된다"는 특성 테스트(EXT-11)로 확인합니다. 이 가정이 깨지면 값을 늘려야 합니다.
- **exactly-once는 보장하지 못합니다.** 외부 API에 멱등 키가 없고, 프로세스가 lease 확인 직후 요청 전송 직전에 오래 멈추면 이전 워커의 늦은 요청이 복구 이후에 나갈 수 있습니다. 이런 중복은 reconcile 때 같은 `clientRef` 내역이 2건 이상이면 기록하지만, 이미 `SENT`로 확정된 뒤 생긴 중복은 드러나지 않습니다.
- **취소의 경계는 보내기 직전 확인입니다.** 취소는 이 확인(알림을 `FOR SHARE`로 읽음)을 아직 지나지 않은 요청을 모두 멈춥니다(UC-26, DB-21). 확인을 지난 요청은 허가 갱신(허가가 오래됐을 때 DB 쓰기 1회)과 lease · 종료 확인만 거쳐 바로 나가므로, 그 짧은 구간(보통 ms 단위)에 커밋된 취소는 그 요청을 막지 못하고 요청은 실제 결과대로 기록됩니다. DB 확인과 외부 HTTP 요청은 하나의 원자적 단계로 묶을 수 없어 이 구간을 0으로 만들 수는 없습니다.
- **워커 호스트의 시계는 NTP로 맞춰져 있다고 가정합니다.** 시계가 크게 어긋나면 fencing이 늦은 결과의 저장은 막지만, 다른 워커가 같은 건을 다시 보내는 외부 중복까지 막지는 못합니다.
- **처리량은 한도 준수를 우선했습니다.** `--scale worker=3`에 mock 기본값(일시 오류 5%, 3초 이상 지연 5%, 30초 타임아웃 2%)으로 10만 명 알림을 보내 보니 429는 0건, 처음 20초 동안 약 29건/초였습니다. 이후 k6로 조회 부하를 함께 준 60초 측정([1-3 부하 테스트](#부하-테스트-k6-선택))에서는 워커 수와 관계없이 초당 14~16건이었습니다. 두 측정 모두 429는 0건이었고, 확장 진행 · 느린 응답과 타임아웃이 슬롯을 붙잡는 영향 · 단일 머신 자원 가운데 무엇이 처리량을 정하는지는 측정으로 나누지 못했습니다.
- 알림 완료 표시는 주기적 확인이라 마지막 결과 확정보다 최대 한 바퀴 + 1초 늦을 수 있습니다.

## 5. 고민한 지점과 되돌린 결정

### 5-1. 고민한 지점

- **"정확히 한 번"을 어디까지 약속할지.** exactly-once가 불가능하니 목표를 "결과를 모르는 건은 확인하기 전에 재전송하지 않는다"로 낮추고, 끝내 확인하지 못한 건은 `FAILED`로 뭉개지 않고 `UNCONFIRMED`로 따로 남겼습니다.
- **처리량 한도를 어떤 구간으로 읽을지.** mock은 토큰 버킷처럼 동작했지만 실제 서비스의 방식은 알 수 없어, 가장 엄격한 해석(임의의 1초 구간 50건)을 허가 발급에 적용하고 처리량 손실은 동시 발송 수로 메웠습니다. 실제 요청 시작 기준 상한은 허가 유효 시간만큼 늘어납니다(3-6).
- **장애 중에 시도 횟수를 언제 쓸지.** 500/503은 시도로 세지만, 429와 연결 실패는 "보내지 못한 것"이라 세지 않고 모든 워커가 함께 쉬게 했습니다. 장애가 길어도 대기 건이 재시도 소진으로 `FAILED`가 되지 않게 하려는 것입니다.
- **port를 얼마나 나눌지.** 쓰임새별로 쪼개면 port 수와 조립 코드가 늘고, 합치면 서비스가 쓰지 않는 메서드까지 받습니다. 개념별 port 하나와 서비스 쪽 `Pick` 선언으로 둘 다 피했습니다.

### 5-2. 되돌린 결정

- **연결 실패를 결과 불명으로 두었던 것.** 발송 API가 내려가 있으면 조회도 실패해, 실제로는 나가지 않은 건이 확인 기간 뒤 `UNCONFIRMED`로 끝났습니다. 일시 오류로 바꾸는 안은 30초 장애에도 재시도 5회가 소진돼 `FAILED`로 끝나는 것을 확인하고 버렸습니다. 요청이 나가지 않은 것이 확실한 연결 실패만 따로 분류해 공유 정지와 시도 미소모로 처리합니다.
- **claim한 뒤 허가를 기다렸던 흐름.** 더 단순하지만 긴급 건이 밀려, 허가를 먼저 얻는 순서로 바꿨습니다.
- **worker loop 정지 시점.** drain과 같은 단계(`beforeApplicationShutdown`)에서 멈췄더니, 같은 단계 안의 순서 때문에 당시 import 구성에서는 drain이 먼저 실행되어 5초 동안 새 claim이 계속될 수 있었습니다. 실제와 같은 모듈 구성으로 재현한 뒤 `onModuleDestroy`로 옮겼고, 허가를 막 얻은 루프까지 막도록 종료 플래그를 더했습니다.
- **완료 확인 전체 순회.** 알림이 많으면 종료할 때 순회가 끝나기를 기다려야 해서, 한 번에 100개씩 이어가게 했습니다.
- **앱 기동 시 마이그레이션.** 잠금 없는 마이그레이션이 동시에 돌 수 있어 일회성 `migrate`로 분리했습니다.
- **claim 트랜잭션에서만 lease를 확인했던 것.** 커밋이 늦으면 lease가 거의 없이 요청을 보낼 수 있어 요청 직전에 다시 확인합니다.
- **쓰임새별 repository port · 설정 port · 완료 판정 port · `port/in` · `port/out` 폴더.** 3-2의 이유로 개념별 port + `Pick`, 설정 타입, 내부 협력자, driving/driven + `for-<목적>`으로 바꿨습니다.
- **목록 키 `items`.** 데이터 모델 예시와 같은 `alarms`로 바꿨습니다.
- **문서의 시각 기준.** claim · 복구도 DB 시계로 판정한다고 적었지만 실제로 필요한 것은 rate limiter뿐이어서, 근거와 함께 구현대로 고쳤습니다.

### 5-3. 테스트로 보장을 확인한 방법

- 시나리오를 먼저 [SCENARIO.md](SCENARIO.md)에 ID로 정하고, ID를 이름에 단 테스트로 하나씩 Red → Green으로 바꿨습니다.
- 구현을 일부러 망가뜨려(변이) 테스트가 실패하는지 확인했습니다. 완료 · reconcile · lease 복구 루프 제거, 우선순위 정렬 반전, rate limiter 해제, 취소 방어선 제거에서 각각 해당 e2e가 실패합니다.
- 이 과정에서 테스트의 빈틈을 찾았습니다. 긴급 우선 판정을 "첫 긴급 발송과 마지막 긴급 발송 사이에 대량 발송이 없다"로 했더니 우선순위를 뒤집으면 긴급이 맨 끝에 몰려 오히려 통과해, 3-7의 기준으로 바꿨습니다. 발송 중 취소 e2e는 "`PENDING`이 아닌 건"을 세다 보니 취소 직후 `CANCELLED`까지 세어 아무것도 검증하지 못했고, 대기 건이 실제로 남았는지 단언을 더해 실패를 확인한 뒤 집계에서 `CANCELLED`를 뺐습니다.
- 시각 비교는 한 시계 안에서만 합니다. 긴급 우선 판정은 mock 발송 시각끼리 비교하고 기준 시점은 DB의 상태 개수로 잡아, 테스트 프로세스와 컨테이너의 시계 차이에 영향받지 않습니다.

## 6. 시간이 더 있다면

- **결과 불명 건 사후 감사와 append-only 시도 이력:** 상태 전이마다 한 행을 쌓는 이력 테이블과, 알림 완료 후 `UNKNOWN`을 거친 건만 다시 조회하는 감사로 `SENT` 확정 뒤 생긴 중복과 시도 경과를 드러내겠습니다.
- **rate limiter가 거절할 때 다음 허가 시각 반환:** 지금은 100ms 폴링이라, 다음 허가 시각만큼만 기다리면 rate limiter 쓰기와 허가 사이의 빈틈이 함께 줄어듭니다.
- **수신자 목록 조회 실패 시 확장 lease 즉시 해제:** 지금은 lease 만료(30초) 뒤에 다시 시도됩니다.
- **쿼리 실행 시간 제한:** 연결 대기 제한(5초)만 있어, `statement_timeout` · `lock_timeout`을 근거와 함께 정하고 통합 테스트로 확인하겠습니다.
- **완료 확인 중복 줄이기:** 워커가 많아지면 advisory lock으로 한 워커만 확인하게 하겠습니다.
- **`noUncheckedIndexedAccess` 도입과 고정 시계 fixture 공용화:** 결과 discriminated union 좁히기와 Gate는 공용 테스트 helper로 모았습니다. 남은 것은 테스트마다 조금씩 다른 고정 시계 fixture의 공용화와, 배열 인덱스 접근의 빈 배열 경로를 컴파일러가 잡게 하는 설정입니다.
- **초기 60초 처리량이 워커 수와 무관하게 초당 14~16건인 원인 분석:** 확장 속도 · mock 응답 지연 · 컨테이너 자원을 나눠 측정하고, 원인이 확장이라면 확장을 발송보다 앞서 몇 페이지 미리 진행하는 방안을 검토합니다.

**AI 도구 사용:** 설계 결정과 코드 검토는 직접 수행했으며, 구현 · 리팩터링 · 리뷰에 Claude와 ChatGPT를 활용했습니다.
