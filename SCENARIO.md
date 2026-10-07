# 테스트 시나리오

구현은 이 문서의 시나리오를 하나씩 Red → Green으로 바꾸는 순서로 진행합니다.
각 시나리오 ID는 테스트 이름의 접두어로 쓰여서 `it.todo('ALM-01 …')`처럼 코드와 연결됩니다.
지금의 `it.todo`는 시나리오 목록을 코드로 옮겨 둔 것이고, Red는 각 시나리오를 구현하기 시작할 때 처음 생깁니다.

| 접두어 | 영역 | 테스트 위치 |
| --- | --- | --- |
| `ALM` | 알림 도메인 규칙 | `src/modules/notification/domain/alarm/*.spec.ts` |
| `DLV` | 수신자별 발송(Delivery) 도메인 규칙 | `src/modules/notification/domain/delivery/*.spec.ts` |
| `UC` | 유스케이스 (포트는 in-memory fake) | `src/modules/notification/application/use-case/*.spec.ts` |
| `WRK` | 워커 실행 · 종료 | `src/modules/notification/infrastructure/worker/*.spec.ts` |
| `DB` | 저장소 · 동시성 (Testcontainers PostgreSQL) | `src/modules/notification/infrastructure/adapter/*.int-spec.ts` |
| `EXT` | 외부 API adapter (Testcontainers mock 서버) | `src/modules/notification/infrastructure/adapter/mock-*.int-spec.ts` |
| `API` | REST API 계약 | `test/alarm.e2e-spec.ts` |
| `E2E` | api + worker + mock 전체 흐름 | `test/dispatch-flow.e2e-spec.ts` |

## 용어

| 용어 | 의미 |
| --- | --- |
| Alarm | 하나의 알림. 제목과 본문, 종류(대량 `BULK` / 긴급 `URGENT`), 상태를 가진다 |
| Delivery | 알림 1건을 수신자 1명에게 보내는 작업. `clientRef`로 delivery id를 그대로 쓴다 |
| 확장(expansion) | 대량 알림의 수신자 전체를 사용자 API에서 cursor로 읽어 Delivery로 만드는 단계 |
| 결과 불확실(UNKNOWN) | 요청은 보냈지만 응답을 받지 못한 상태. mock은 이 경우에도 발송을 처리했을 수 있다 |
| reconcile | `GET /v1/messages?clientRef=`로 실제 발송 여부를 확인해 UNKNOWN을 SENT 또는 재시도로 확정하는 단계 |
| lease | 워커가 Delivery를 처리하는 동안 갖는 임시 소유권. claim할 때마다 새 `leaseToken`과 만료 시각이 발급된다 |
| fencing | 결과를 저장할 때 `leaseToken`이 현재 값과 같아야만 저장되게 해서, lease를 잃은 워커의 늦은 결과를 막는 것 |
| reconcile 가능 시각 | 마지막 요청 시작 시각(요청 시작을 모르면 lease 만료 시각) + `RECONCILE_DELAY_MS`. 근거는 mock 명세의 "응답 지연은 최대 `TIMEOUT_MS`(30초)"이고, 클라이언트 타임아웃은 서버 처리 종료의 근거가 아니다 |
| UNCONFIRMED | 확인 기간(`UNCONFIRMED_AFTER_MS`)이 지나도 발송 여부를 확정하지 못한 종결 상태. 실제로 나갔을 수 있으므로 FAILED와 구분하고 운영 확인 대상으로 집계한다 |
| 발송 허가 | 공유 처리량 제한기에서 얻는 1건분의 토큰. 워커는 허가를 먼저 얻고, 그 시점에 발송 가능한 Delivery 중 우선순위가 가장 높은 1건을 claim해 바로 보낸다 |

## 상태 모델

```
Alarm
  DRAFT ──dispatch──▶ DISPATCHING ──(확장 완료 + 미종결 Delivery 0건)──▶ COMPLETED
    │                     │
    └──────cancel─────────┴──────────────────────────────────────────▶ CANCELLED

Delivery
  PENDING ──claim(leaseToken)──▶ IN_FLIGHT ──202──────────────────────▶ SENT
     ▲                              │ ──400 (영구 실패)────────────────▶ FAILED
     │                              │ ──500/503/429─▶ RETRY_WAIT ─(재시도 시각 이후 바로 claim)─▶ IN_FLIGHT
     │                              │ ──타임아웃·연결 오류·lease 만료─▶ UNKNOWN
     └──────────────────────────────┘
  UNKNOWN ──(reconcile 가능 시각 이후) 내역 있음──▶ SENT
          ──(reconcile 가능 시각 이후) 내역 없음──▶ RETRY_WAIT (시도 소진이면 FAILED, 알림이 취소됐으면 CANCELLED)
          ──조회 실패──▶ UNKNOWN 유지 (백오프 후 재조회)
          ──확인 기간 초과──▶ UNCONFIRMED (종결, 운영 확인 대상)
  PENDING · RETRY_WAIT ──cancel──▶ CANCELLED      (IN_FLIGHT · UNKNOWN은 결과를 먼저 확정)
```

## 보장 범위

- 같은 (알림, 수신자)의 Delivery는 하나만 존재한다 (unique 제약).
- 같은 Delivery를 두 워커가 동시에 소유하지 않는다 (`FOR UPDATE SKIP LOCKED` + lease).
- lease를 잃은 워커의 결과는 저장되지 않는다 (fencing).
- 결과가 불확실한 건은 reconcile 가능 시각 이후 조회로 확정한 뒤에만 재전송한다.
- 가정: mock은 발송 내역을 응답보다 먼저 기록하고, 응답 지연은 최대 `TIMEOUT_MS`다. 기록 시점은 특성 테스트(EXT-11)로 확인한다. 이 가정이 깨지면 `RECONCILE_DELAY_MS`를 늘려야 한다.
- 한계: 외부 API가 멱등성을 지원하지 않으므로 exactly-once는 보장하지 못한다. 프로세스가 lease 확인 직후 요청 전송 직전에 오래 멈추면 이전 워커의 늦은 요청이 복구 이후에 나갈 수 있다. 이런 중복은 reconcile 조회 때 같은 `clientRef` 내역이 2건 이상 나오면 기록하지만, 이미 SENT로 확정된 뒤 생긴 중복은 사후 감사(선택 구현) 없이는 드러나지 않는다.

## ALM · 알림 도메인

| ID | Given | When | Then |
| --- | --- | --- | --- |
| ALM-01 | 제목과 본문이 있는 대량 알림 요청 | 알림을 만든다 | `DRAFT` 상태이고 수신 대상은 전체 사용자다 |
| ALM-02 | 제목이나 본문이 비어 있다 | 알림을 만든다 | 생성이 거부된다 |
| ALM-03 | 수신자 1~100명을 지정한 긴급 알림 요청 | 알림을 만든다 | `DRAFT` 상태이고 지정한 수신자를 중복 없이 가진다 (인원은 중복 제거 후 센다) |
| ALM-04 | 수신자가 0명이거나 100명을 넘거나, 형식이 잘못된 수신자 id가 섞인 긴급 알림 요청 | 알림을 만든다 | 생성이 거부된다 |
| ALM-05 | 대량 알림에 수신자를 지정했다 | 알림을 만든다 | 생성이 거부된다 (대량 알림은 전체 사용자 대상) |
| ALM-06 | `DRAFT` 알림 | 발송을 시작한다 | `DISPATCHING`이 되고 시작 시각이 기록된다 |
| ALM-07 | `DISPATCHING`·`COMPLETED`·`CANCELLED` 알림 | 발송을 시작한다 | 상태 충돌로 거부되고 상태는 바뀌지 않는다 |
| ALM-08 | `DRAFT` 또는 `DISPATCHING` 알림 | 취소한다 | `CANCELLED`가 되고 취소 시각과 함께 발송 시작 여부(발송 전 취소면 없음, 발송 중 취소면 시작 시각)가 기록된다 |
| ALM-09 | `COMPLETED`·`CANCELLED` 알림 | 취소한다 | 상태 충돌로 거부된다 |
| ALM-10 | `DISPATCHING` 알림 | 확장 완료이고 미종결 Delivery가 0건이라는 판정 근거를 받는다 | `COMPLETED`가 된다 |
| ALM-11 | `DISPATCHING` 알림 | 확장 미완료이거나 미종결 Delivery가 남아 있다는 판정 근거를 받는다 | `DISPATCHING`을 유지한다 |
| ALM-12 | `DRAFT`·`COMPLETED`·`CANCELLED` 알림 | 완료를 판정한다 | 상태 충돌로 거부된다 |

## DLV · 발송 도메인

| ID | Given | When | Then |
| --- | --- | --- | --- |
| DLV-01 | `PENDING` Delivery | 워커가 claim한다 | `IN_FLIGHT`가 되고 새 leaseToken과 lease 만료 시각이 기록된다. 시도 횟수는 아직 늘지 않는다 |
| DLV-02 | `IN_FLIGHT` Delivery | 실제 HTTP 요청을 시작한다 | 시도 횟수가 1 늘고 요청 시작 시각이 기록된다. 이미 시작한 요청은 다시 시작할 수 없다 |
| DLV-03 | `IN_FLIGHT` Delivery | 202 응답을 받는다 | `SENT`가 되고 messageId가 기록된다 |
| DLV-04 | `IN_FLIGHT` Delivery | 400 `RECIPIENT_BLOCKED`·`UNKNOWN_RECIPIENT`·`INVALID_REQUEST`를 받는다 | 재시도 없이 `FAILED`가 되고 사유 코드가 기록된다 |
| DLV-05 | `IN_FLIGHT` Delivery | 500/503을 받는다 | `RETRY_WAIT`가 되고 지수 백오프(+jitter)로 다음 시도 시각이 정해진다 |
| DLV-06 | 최대 시도 횟수에 도달한 Delivery | 500/503을 받는다 | `FAILED`(`RETRY_EXHAUSTED`)가 된다 |
| DLV-07 | `IN_FLIGHT` Delivery | 429와 `Retry-After: n`을 받는다 | `RETRY_WAIT`가 되고 n초 뒤로 미뤄지며 시도 횟수는 되돌린다 |
| DLV-08 | `IN_FLIGHT` Delivery | 응답 타임아웃·연결 오류가 난다 | 재전송하지 않고 `UNKNOWN`이 되며 reconcile 가능 시각(요청 시작 + `RECONCILE_DELAY_MS`)이 기록된다 |
| DLV-09 | `UNKNOWN` Delivery | reconcile에서 같은 clientRef의 발송 내역 1건을 찾는다 | `SENT`가 되고 messageId가 기록된다 |
| DLV-10 | reconcile 가능 시각이 지난 `UNKNOWN` Delivery | reconcile에서 발송 내역이 없다 | 최대 시도 횟수 안이면 `RETRY_WAIT`, 소진했으면 `FAILED`(`RETRY_EXHAUSTED`)가 된다 |
| DLV-11 | reconcile 가능 시각 전의 `UNKNOWN` Delivery | reconcile 대상을 고른다 | 대상에서 빠진다 (이전 요청이 아직 진행 중일 수 있음) |
| DLV-12 | `UNKNOWN` Delivery | 발송 내역 조회 자체가 실패한다 | 빈 내역으로 보지 않고 `UNKNOWN`을 유지하며 백오프 후 다음 조회를 예약한다 |
| DLV-13 | `UNKNOWN` Delivery | 같은 clientRef의 발송 내역이 2건 이상 나온다 | `SENT`가 되고 중복 발송 건수가 기록된다 |
| DLV-14 | lease가 만료된 `IN_FLIGHT` Delivery (워커 종료) | 복구를 실행한다 | 재전송하지 않고 `UNKNOWN`으로 넘기며 reconcile 가능 시각(lease 만료 + `RECONCILE_DELAY_MS`)을 기록한다 |
| DLV-15 | leaseToken이 바뀐 Delivery (다른 워커가 이어받음) | 이전 워커가 결과를 저장한다 | 저장이 거부된다 |
| DLV-16 | 요청을 아직 시작하지 않았고 남은 lease 시간이 HTTP 최대 실행 시간보다 짧은 `IN_FLIGHT` Delivery | 요청을 시작하려 한다 | 요청을 시작하지 않고 lease를 반납한다 (이미 시작한 요청은 반납하지 않는다) |
| DLV-17 | `PENDING`·`RETRY_WAIT` Delivery | 알림이 취소된다 | `CANCELLED`가 된다 |
| DLV-18 | 알림이 취소된 뒤의 `IN_FLIGHT` Delivery | 늦게 202를 받는다 | 이미 나간 사실대로 `SENT`가 된다 |
| DLV-19 | `UNKNOWN` Delivery이고 알림이 취소됐다 | reconcile에서 발송 내역이 없다 | 재시도 대신 `CANCELLED`가 된다 |
| DLV-20 | `SENT`·`FAILED`·`CANCELLED`·`UNCONFIRMED` Delivery | 어떤 결과든 다시 기록하려 한다 | 종결 상태는 바뀌지 않는다 |
| DLV-21 | 확인 기간(`UNCONFIRMED_AFTER_MS`)이 지난 `UNKNOWN` Delivery | reconcile 대상을 고른다 | 재전송하지 않고 `UNCONFIRMED`로 종결된다 |

## UC · 유스케이스

| ID | Given | When | Then |
| --- | --- | --- | --- |
| UC-01 | 유효한 요청 | 알림 생성 유스케이스 | 저장소에 `DRAFT` 알림이 저장되고 반환된다 |
| UC-02 | 없는 알림 id | 조회·발송 시작·취소 | 알림 없음 오류가 난다 |
| UC-03 | 긴급 `DRAFT` 알림 | 발송 시작 | 같은 트랜잭션에서 상태 변경과 수신자별 Delivery 생성이 함께 커밋된다 |
| UC-04 | 대량 `DRAFT` 알림 | 발송 시작 | 같은 트랜잭션에서 상태 변경과 확장 작업 생성이 함께 커밋된다 |
| UC-05 | 발송 시작 중 | 작업 생성이 실패한다 | 전체가 롤백되어 알림은 `DRAFT`로 남는다 |
| UC-06 | 확장 대기 중인 대량 알림 | 확장 유스케이스가 사용자 API를 cursor 끝까지 읽는다 | 페이지마다 Delivery 생성과 cursor 저장이 한 트랜잭션으로 커밋된다 |
| UC-07 | 확장 도중 워커가 멈췄다 | 다른 워커가 확장을 이어받는다 | 저장된 cursor부터 이어서 읽고 같은 수신자의 Delivery는 중복 생성되지 않는다 |
| UC-08 | 확장 중 알림이 취소됐다 | 다음 페이지를 처리한다 | 확장을 멈추고 더 이상 Delivery를 만들지 않는다 |
| UC-09 | 대기 중 Delivery 여러 건 | 발송 유스케이스 | 발송 허가를 먼저 얻고, 그 시점에 발송 가능한 건 중 우선순위가 가장 높은 1건을 claim해 바로 보내며 결과를 fencing 조건으로 기록한다 |
| UC-10 | 발송 허가를 얻지 못했다 | 발송 유스케이스 | claim하지 않고 다음 주기를 기다린다 (claim한 채 허가를 기다리지 않는다) |
| UC-11 | 429 응답 | 발송 유스케이스 | 공유 처리량 제한기에 `Retry-After`만큼 정지가 걸려 모든 워커가 함께 멈춘다 |
| UC-12 | 발송 결과 확정 · reconcile 확정 · 확장 완료(수신자 0명 포함) | 완료 판정 유스케이스 | 확장 완료이고 미종결 Delivery가 0건이면(`UNCONFIRMED`는 종결로 셈) 알림이 `COMPLETED`가 된다 |
| UC-13 | 취소된 알림의 대기 Delivery | 취소 유스케이스 | 대기 Delivery가 한 번에 `CANCELLED`가 되고 처리 중인 건은 결과 확정 후 정리된다 |
| UC-14 | reconcile 가능 시각이 지난 `UNKNOWN` Delivery 여러 건 | reconcile 유스케이스 | 건마다 발송 내역을 조회해 DLV-09~13, DLV-19, DLV-21 규칙대로 확정한다 |
| UC-15 | 외부 발송이 성공한 직후 결과 저장 전에 워커가 멈췄다 | lease 만료 후 복구와 reconcile을 실행한다 | 재전송 없이 `SENT`로 확정된다 |

## WRK · 워커 실행과 종료

| ID | Given | When | Then |
| --- | --- | --- | --- |
| WRK-01 | 워커 모듈 | 애플리케이션 부트스트랩이 끝난다 | 확장 · 발송 · reconcile · lease 복구 루프가 시작된다 |
| WRK-02 | 실행 중인 워커 | 종료 신호를 받는다 | 새 claim을 즉시 멈추고 readiness를 내린다 |
| WRK-03 | 진행 중인 요청이 있는 워커 | 종료 절차가 진행된다 | 진행 중 요청의 결과를 제한 시간 안에 저장한 뒤 DB 연결을 닫는다 |
| WRK-04 | 제한 시간 안에 끝나지 않는 요청 | 종료 절차가 진행된다 | 요청을 중단하고 lease를 남겨 둔 채 종료하며, 남은 건은 lease 만료 후 다른 워커가 reconcile한다 |

## DB · 저장소와 동시성 (Testcontainers PostgreSQL)

| ID | Given | When | Then |
| --- | --- | --- | --- |
| DB-01 | 알림 저장소 | 저장 후 id로 조회한다 | 같은 도메인 객체로 복원된다 |
| DB-02 | 알림 여러 개 | 상태·종류 필터와 cursor로 목록을 조회한다 | 생성 역순으로 페이지가 나뉘고 다음 cursor가 반환된다 |
| DB-03 | 생성 시각이 같은 알림 여러 개 | cursor로 끝까지 조회한다 | (생성 시각, id) 복합 cursor로 누락·중복 없이 이어진다 |
| DB-04 | 같은 `DRAFT` 알림 | 발송 시작 요청 두 개가 동시에 들어온다 | 하나만 성공하고 나머지는 상태 충돌이 난다 |
| DB-05 | `DRAFT` 알림 | 발송 시작과 취소가 동시에 들어온다 | 최종 상태와 각 요청의 성공·실패가 어떤 직렬 실행 순서의 결과와 일치한다 |
| DB-06 | 대기 Delivery 100건 | 워커 3개가 동시에 claim한다 (`FOR UPDATE SKIP LOCKED`) | 같은 Delivery를 두 워커가 가져가지 않는다 |
| DB-07 | 같은 (알림, 수신자) | Delivery를 두 번 만든다 | unique 제약으로 하나만 남는다 |
| DB-08 | 발송 가능한 긴급 Delivery와 대량 Delivery가 함께 대기 중 | 워커가 claim한다 | 긴급 Delivery가 먼저 나오고, `RETRY_WAIT`(재시도 시각 전) 긴급 Delivery는 대량 Delivery의 claim을 막지 않는다 |
| DB-09 | lease가 만료된 `IN_FLIGHT` Delivery | 복구 쿼리 | `UNKNOWN`으로 바뀌고 reconcile 가능 시각이 기록된다 |
| DB-10 | 다른 leaseToken으로 결과 저장 | 갱신 쿼리 | 0행이 갱신되고 기존 상태가 유지된다 |
| DB-11 | 초당 50건 제한기 (초기 상태 포함) | 워커 여러 개가 경계 시각 전후로 토큰을 요청한다 | 임의의 1초 구간에서 발급된 토큰 합이 50을 넘지 않는다 |
| DB-12 | 제한기가 `Retry-After`로 정지됐다 | 정지 시각 전에 토큰을 요청한다 | 0개를 받는다 |
| DB-13 | 정지 중인 제한기 | 더 짧은 `Retry-After`가 들어온다 | 정지 시각이 앞당겨지지 않는다 |

## EXT · 외부 API adapter (Testcontainers mock 서버)

| ID | Given | When | Then |
| --- | --- | --- | --- |
| EXT-01 | mock 사용자 API | cursor로 끝까지 읽는다 | `USER_COUNT`명이 중복 없이 나오고 마지막 페이지는 `{ kind: 'end' }`로 표현된다 |
| EXT-02 | mock 발송 API | 정상 발송 | `Accepted(messageId)` 결과가 나온다 |
| EXT-03 | 수신 거부 사용자 | 발송 | `PermanentFailure(RECIPIENT_BLOCKED)` 결과가 나온다 |
| EXT-04 | `RATE_LIMIT`을 낮춘 mock | 한도를 넘겨 발송 | `RateLimited(retryAfterMs)` 결과가 나온다 |
| EXT-05 | `ERROR_RATE=1` mock | 발송 | `TransientFailure` 결과가 나온다 |
| EXT-06 | `TIMEOUT_RATE=1` mock | 발송 | 클라이언트 타임아웃 후 `Indeterminate` 결과가 나온다 |
| EXT-07 | 이미 발송된 clientRef | 발송 내역을 조회한다 | messageId가 담긴 내역이 나온다 |
| EXT-08 | 발송하지 않은 clientRef | 발송 내역을 조회한다 | 빈 내역이 나온다 |
| EXT-09 | 조회 API가 오류를 내거나 스키마와 다른 응답을 준다 | 발송 내역을 조회한다 | 빈 내역이 아니라 `LookupFailed` 결과가 나온다 |
| EXT-10 | 기본 `RATE_LIMIT` mock | 제한기를 거쳐 2초 동안 연속 발송한다 | 429가 나오지 않는다 (mock 한도 구간 방식에 대한 특성 테스트) |
| EXT-11 | `TIMEOUT_RATE=1` mock | 발송 요청 직후 응답을 기다리는 동안 발송 내역을 조회한다 | 내역이 이미 있다 (발송 기록 시점에 대한 특성 테스트, reconcile 가정의 근거) |

## API · REST 계약

| ID | Given | When | Then |
| --- | --- | --- | --- |
| API-01 | 유효한 본문 | `POST /alarms` | 201과 알림 리소스 |
| API-02 | 잘못된 본문 | `POST /alarms` | 400 Problem Details (`VALIDATION_FAILED`, 필드별 errors) |
| API-03 | 알림 여러 개 | `GET /alarms?status=&kind=&cursor=&limit=` | 200 `{ items, page: { nextCursor } }` (마지막 페이지는 `nextCursor` 필드 없음) |
| API-04 | 있는 알림 | `GET /alarms/:id` | 200과 Delivery 상태별 집계 |
| API-05 | 없는 알림 | `GET /alarms/:id` | 404 Problem Details (`ALARM_NOT_FOUND`) |
| API-06 | uuid가 아닌 id | `GET /alarms/:id` | 400 Problem Details |
| API-07 | `DRAFT` 알림 | `POST /alarms/:id/dispatch` | 202와 `DISPATCHING` 알림 |
| API-08 | 이미 시작한 알림 | `POST /alarms/:id/dispatch` | 409 Problem Details (`ALARM_STATE_CONFLICT`) |
| API-09 | `DRAFT`·`DISPATCHING` 알림 | `POST /alarms/:id/cancel` | 200과 `CANCELLED` 알림 |
| API-10 | 종결된 알림 | `POST /alarms/:id/cancel` | 409 Problem Details (`ALARM_STATE_CONFLICT`) |
| API-11 | 실행 중인 api | `GET /docs-json` | OpenAPI 3 문서가 나온다 |

## E2E · 전체 흐름 (api + worker + mock + PostgreSQL)

| ID | Given | When | Then |
| --- | --- | --- | --- |
| E2E-01 | `USER_COUNT`를 줄이고 일시 오류·타임아웃을 끈 mock, 워커 1개 | 대량 알림을 만들고 발송을 시작한다 | 수신 거부가 아닌 사용자는 mock 발송 내역 기준 정확히 1회, 수신 거부 사용자는 0회 발송되어 `FAILED`가 되고, 알림이 `COMPLETED`가 된다 |
| E2E-02 | 오류·타임아웃 비율을 높인 mock | 대량 알림 발송 | 일시 오류는 재시도되고, 타임아웃 건은 reconcile로 확정되어 같은 clientRef 내역이 2건 이상인 Delivery가 없다 |
| E2E-03 | 대량 알림 발송 중 | 긴급 알림이 발송 가능해진다 | 발송 가능한 긴급 Delivery가 남아 있는 동안 발송 허가를 얻은 요청은 모두 긴급 Delivery를 보낸다 (이미 시작된 대량 요청은 제외) |
| E2E-04 | 워커 3개 | 대량 알림 발송 | 429가 지속되지 않고 중복·누락 없이 끝난다 |
| E2E-05 | 워커 3개로 발송 중 | 워커 하나를 강제로 멈춘다 | 남은 워커가 lease 만료분까지 이어받아 중복·누락 없이 끝난다 |
| E2E-06 | 대량 알림 발송 중 | 알림을 취소한다 | 새 발송이 멈추고, 이미 나간 건은 `SENT`로 남으며 나머지는 `CANCELLED`가 된다 |
| E2E-07 | 실제 worker 자식 프로세스 | SIGTERM을 보낸다 | readiness가 내려가고 새 claim이 멈추며, 진행 중 요청을 마무리하고 exit 0으로 끝난다 (`enableShutdownHooks`의 `useProcessExit: true`) |
