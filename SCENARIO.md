# 테스트 시나리오

구현은 이 문서의 시나리오를 하나씩 Red → Green으로 바꾸는 순서로 진행합니다.
각 시나리오 ID는 테스트 이름의 접두어로 쓰여서 `it.todo('ALM-01 …')`처럼 코드와 연결됩니다.
지금의 `it.todo`는 시나리오 목록을 코드로 옮겨 둔 것이고, Red는 각 시나리오를 구현하기 시작할 때 처음 생깁니다.

| 접두어 | 영역 | 테스트 위치 |
| --- | --- | --- |
| `ALM` | 알림 도메인 규칙 | `src/modules/notification/domain/alarm/*.spec.ts` |
| `DLV` | 수신자별 발송(Delivery) 도메인 규칙 | `src/modules/notification/domain/delivery/*.spec.ts` |
| `UC` | 유스케이스 | `src/modules/notification/application/service/<개념>/*.spec.ts` (포트는 `testing/in-memory` fake) |
| `CFG` | 환경 설정 검증 | `src/shared/config/env.schema.spec.ts` |
| `WRK` | 워커 실행 · 종료 | `src/modules/notification/adapter/driving/worker/*.spec.ts` |
| `DB` | 저장소 · 동시성 (Testcontainers PostgreSQL) | `src/modules/notification/adapter/driven/persistence/**/*.int-spec.ts` · `src/modules/notification/testing/contract/*.contract.ts` |
| `EXT` | 외부 API adapter (Testcontainers mock 서버) | `src/modules/notification/adapter/driven/mock-api/**/*.int-spec.ts` |
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
     │                              │ ──타임아웃·요청 후 연결 끊김·lease 만료─▶ UNKNOWN
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
| DLV-08 | `IN_FLIGHT` Delivery | 응답 타임아웃이 나거나 요청을 보낸 뒤 연결이 끊긴다 | 재전송하지 않고 `UNKNOWN`이 되며 reconcile 가능 시각(요청 시작 + `RECONCILE_DELAY_MS`)이 기록된다 |
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
| DLV-22 | `IN_FLIGHT` Delivery | 발송 API에 연결 자체를 하지 못한다 | `RETRY_WAIT`(`UNREACHABLE`)가 되고 대기 시간 뒤로 미뤄지며 시도 횟수는 되돌린다 |
| DLV-23 | `UNKNOWN` Delivery | reconcile 대상으로 예약한다 | reconcile 가능 시각이 지금 + lease로 미뤄지고 결과 불명 시작 시각과 조회 실패 횟수는 유지된다 |
| DLV-24 | 요청 시작을 기록했지만 실제로 보내지 않은 `IN_FLIGHT` Delivery | 보내지 않은 요청을 거둬들인다 | 시도 횟수를 요청 시작 전으로 되돌리고 lease를 반납해 `PENDING`으로 돌아간다 (같은 leaseToken으로 시작한 요청만 거둘 수 있다) |

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
| UC-16 | Delivery가 있는 알림 | 조회 유스케이스 | 알림과 상태별 Delivery 수를 같은 스냅샷에서 함께 반환한다 |
| UC-17 | 상태·종류가 다른 알림 여러 개 | 목록 조회 유스케이스 | 필터에 맞는 알림을 생성 역순으로 한 페이지 반환하고, 더 있으면 다음 시작 위치를 함께 반환한다 |
| UC-18 | 진행 중인 확장 작업 여러 개 | 다음 확장 페이지 유스케이스 | 잡을 수 있는 작업 하나의 한 페이지만 처리하고 진행을 기록해, 다음 페이지는 다른 워커도 이어받을 수 있다 |
| UC-19 | 발송 중인 알림 여러 개 | 완료 확인 유스케이스 | 발송 중인 알림을 모두 확인해 확장이 끝나고 미종결 Delivery가 없는 알림만 `COMPLETED`로 바꾼다 |
| UC-20 | 발송 API 연결 실패 | 발송 유스케이스 | 공유 처리량 제한기에 대기 시간만큼 정지가 걸려 모든 워커가 함께 멈추고, 해당 건은 시도 횟수를 쓰지 않고 `RETRY_WAIT`가 된다 (장애가 길어도 대기 건이 소모되거나 `UNKNOWN`으로 넘어가지 않는다) |
| UC-21 | 발송 허가를 기다리는 사이 워커 종료가 요청됐다 | 발송 유스케이스 | 허가를 얻어도 새 Delivery를 claim하지 않고 멈춘다 (이미 시작한 요청의 결과 저장은 계속한다) |
| UC-22 | 결과 불명 Delivery 여러 건 | 두 워커가 동시에 reconcile한다 | 한 워커가 조회하는 동안 다른 워커는 같은 건을 고르지 않고 다른 건을 조회한다 (조회하던 워커가 멈추면 lease가 지난 뒤 다른 워커가 다시 조회한다) |
| UC-23 | claim 커밋이 늦어져 보내기 직전 남은 lease가 HTTP 최대 실행 시간보다 짧다 | 발송 유스케이스 | 요청을 보내지 않고 leaseToken이 그대로일 때만 lease를 반납해 시도 횟수를 쓰지 않은 채 다시 발송 가능한 `PENDING`으로 되돌린다 (그 사이 다른 워커가 이어받았으면 저장하지 않는다) |

## CFG · 환경 설정 검증

| ID | Given | When | Then |
| --- | --- | --- | --- |
| CFG-01 | 종료 drain·timeout 중 하나 또는 두 값의 합계가 2,147,483,647ms를 초과한다 | 환경변수를 검증한다 | 프로세스 기동 전에 설정을 거부한다 |
| CFG-02 | drain이 0 이상이고 timeout이 양수이며 합계가 2,147,483,647ms 이하인 정수 설정 | 환경변수를 검증한다 | drain 0과 합계 상한을 포함해 허용한다 |
| CFG-03 | lease·확인 기간이 Node 타이머 상한을 초과한다 | 환경변수를 검증한다 | 직접 타이머에 쓰지 않는 일반 기간은 종료 타이머 상한 때문에 거부하지 않는다 |
| CFG-04 | `DATABASE_POOL_MAX`를 지정하지 않는다 | 환경변수를 검증한다 | 워커 루프와 헬스 검사를 함께 감당하도록 Pool 최대 연결 수를 20으로 둔다 |
| CFG-05 | `DATABASE_POOL_MAX`가 양의 정수가 아니다 | 환경변수를 검증한다 | 프로세스 기동 전에 설정을 거부한다 |

## WRK · 워커 실행과 종료

| ID | Given | When | Then |
| --- | --- | --- | --- |
| WRK-01 | 워커 모듈 | 애플리케이션 부트스트랩이 끝난다 | 확장 · 발송 · reconcile · lease 복구 · 완료 확인 루프가 시작된다 |
| WRK-02 | 실행 중인 워커 | 종료 신호를 받는다 | 새 claim을 즉시 멈추고 readiness를 내린다 |
| WRK-03 | 진행 중인 요청이 있는 워커 | 종료 절차가 진행된다 | 진행 중 요청의 결과를 제한 시간 안에 저장한 뒤 DB 연결을 닫는다 |
| WRK-04 | 외부 요청을 중단해도 제한 시간 안에 끝나지 않는 작업 | 종료 절차가 진행된다 | lease를 남겨 둔 채 exit(1)로 종료하며, 남은 건은 lease 만료 후 다른 워커가 복구해 reconcile한다 |
| WRK-05 | 제한 시간의 절반이 지나도 끝나지 않는 외부 요청 | 종료 절차가 진행된다 | 요청을 중단하고 결과를 결과 불명(`UNKNOWN`)으로 저장한 뒤 DB 연결을 닫는다 |

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
| DB-14 | 같은 `UNKNOWN` Delivery | 두 워커가 reconcile 결과를 차례로 저장한다 | 먼저 저장한 결과만 반영되고 늦은 결과는 저장되지 않는다 (조건부 갱신) |
| DB-15 | 알림 상태 변경과 Delivery 또는 확장 작업 생성을 한 트랜잭션에서 진행 중 | 트랜잭션 도중 실패한다 | 알림 상태 변경과 함께 만든 Delivery·확장 작업이 모두 롤백된다 |
| DB-16 | 여러 상태의 Delivery를 가진 알림과 다른 알림 | 알림의 상태별 Delivery 수를 조회한다 | 그 알림의 건만 상태마다 세고, 건이 없는 상태는 0이다 |
| DB-17 | 발송 중인 알림 | 한 스냅샷 안에서 상태별 Delivery 수를 두 번 읽는 사이에 다른 트랜잭션이 Delivery를 바꿔 커밋한다 | 스냅샷 안의 두 조회는 같은 시점의 값을 본다 |
| DB-18 | 진행 중인 확장 작업 여러 개 | 워커가 확장 작업을 claim한다 | lease가 없거나 만료된 작업 중 가장 먼저 만든 작업을 잡아 lease를 걸고, 잡힌 작업은 다른 워커가 가져가지 않는다 |
| DB-19 | reconcile 대상으로 예약해 저장한 `UNKNOWN` Delivery | reconcile 후보를 고른다 | 예약 시각 전에는 후보에서 빠지고 이후 다시 후보가 된다 |
| DB-20 | 응답을 기다리는 Delivery가 있는 알림을 취소 트랜잭션이 잠그고 대기 Delivery를 취소한 채 아직 커밋하지 않았다 | 워커가 재시도할 결과를 저장한다 | 결과 저장이 취소 커밋을 기다렸다가 취소된 알림을 보고 `RETRY_WAIT` 대신 `CANCELLED`로 저장한다 (발송 결과와 reconcile 결과 모두 알림을 공유 잠금(`FOR SHARE`)으로 읽는다) |

## EXT · 외부 API adapter (Testcontainers mock 서버)

| ID | Given | When | Then |
| --- | --- | --- | --- |
| EXT-01 | mock 사용자 API | cursor로 끝까지 읽는다 | `USER_COUNT`명이 중복 없이 나오고 마지막 페이지는 `{ kind: 'end' }`로 표현된다 (조회 실패·잘못된 응답은 빈 페이지가 아니라 실패로 알려 수신자 누락을 막는다) |
| EXT-02 | mock 발송 API | 정상 발송 | `Accepted(messageId)` 결과가 나온다 |
| EXT-03 | 수신 거부 사용자 | 발송 | `PermanentFailure(RECIPIENT_BLOCKED)` 결과가 나온다 |
| EXT-04 | `RATE_LIMIT`을 낮춘 mock | 한도를 넘겨 발송 | `RateLimited(retryAfterMs)` 결과가 나온다 (`Retry-After`는 초 단위 정수만 받고 1시간에서 자르며, 없거나 형식이 다르면 1초) |
| EXT-05 | `ERROR_RATE=1` mock | 발송 | `TransientFailure` 결과가 나온다 |
| EXT-06 | `TIMEOUT_RATE=1` mock | 발송 | 클라이언트 타임아웃 후 `Indeterminate` 결과가 나온다 |
| EXT-07 | 이미 발송된 clientRef | 발송 내역을 조회한다 | messageId가 담긴 내역이 나온다 |
| EXT-08 | 발송하지 않은 clientRef | 발송 내역을 조회한다 | 빈 내역이 나온다 |
| EXT-09 | 조회 API가 오류를 내거나 스키마와 다른 응답을 준다 | 발송 내역을 조회한다 | 빈 내역이 아니라 `LookupFailed` 결과가 나온다 |
| EXT-10 | 기본 `RATE_LIMIT` mock | 제한기를 거쳐 2초 동안 연속 발송한다 | 429가 나오지 않는다 (mock 한도 구간 방식에 대한 특성 테스트) |
| EXT-11 | `TIMEOUT_RATE=1` mock | 발송 요청 직후 응답을 기다리는 동안 발송 내역을 조회한다 | 내역이 이미 있다 (발송 기록 시점에 대한 특성 테스트, reconcile 가정의 근거) |
| EXT-12 | 연결을 거부하는 발송 API (연결 거부·주소 해석 실패) | 발송 | 요청이 나가지 않았으므로 `Unreachable(retryAfterMs)` 결과가 나온다 |
| EXT-13 | 요청을 받은 뒤 연결을 끊는 발송 API | 발송 | 발송됐을 수 있으므로 `Indeterminate` 결과가 나온다 |
| EXT-14 | 응답하지 않는 mock API에 요청 중 | 워커 종료로 요청을 중단한다 | 요청 제한 시간을 기다리지 않고, 발송은 발송됐을 수 있으므로 `Indeterminate`, 발송 내역 조회는 `LookupFailed`, 사용자 조회는 실패로 끝난다 |

## API · REST 계약

| ID | Given | When | Then |
| --- | --- | --- | --- |
| API-01 | 유효한 본문 | `POST /alarms` | 201과 알림 리소스 |
| API-02 | 잘못된 본문 | `POST /alarms` | 400 Problem Details (`VALIDATION_FAILED`, 필드별 errors) |
| API-03 | 알림 여러 개 | `GET /alarms?status=&kind=&cursor=&limit=` | 200 `{ alarms, page: { nextCursor } }` (마지막 페이지는 `nextCursor` 필드 없음) |
| API-04 | 있는 알림 | `GET /alarms/:id` | 200과 Delivery 상태별 집계 |
| API-05 | 없는 알림 | `GET /alarms/:id` | 404 Problem Details (`ALARM_NOT_FOUND`) |
| API-06 | uuid가 아닌 id | `GET /alarms/:id` | 400 Problem Details |
| API-07 | `DRAFT` 알림 | `POST /alarms/:id/dispatch` | 202와 `DISPATCHING` 알림 |
| API-08 | 이미 시작한 알림 | `POST /alarms/:id/dispatch` | 409 Problem Details (`ALARM_STATE_CONFLICT`) |
| API-09 | `DRAFT`·`DISPATCHING` 알림 | `POST /alarms/:id/cancel` | 200과 `CANCELLED` 알림 |
| API-10 | 종결된 알림 | `POST /alarms/:id/cancel` | 409 Problem Details (`ALARM_STATE_CONFLICT`) |
| API-11 | 실행 중인 api | `GET /docs-json` | OpenAPI 3 문서가 나온다 |
| API-12 | 실행 중인 api | `GET /docs-json` | 다섯 작업의 성공 응답은 `application/json` 스키마를, 400·404·409 오류 응답은 필수 필드(`type` · `title` · `status` · `detail` · `instance` · `code` · `errors`)를 갖춘 `application/problem+json` 스키마를 문서화하고, 목록 응답은 `alarms` · `page.nextCursor`를 담는다 |

## E2E · 전체 흐름 (api + worker + mock + PostgreSQL)

| ID | Given | When | Then |
| --- | --- | --- | --- |
| E2E-01 | `USER_COUNT`를 줄이고 일시 오류·타임아웃을 끈 mock, 워커 1개 | 대량 알림을 만들고 발송을 시작한다 | 수신 거부가 아닌 사용자는 mock 발송 내역 기준 정확히 1회, 수신 거부 사용자는 0회 발송되어 `FAILED`가 되고, 알림이 `COMPLETED`가 된다 |
| E2E-02 | 오류·타임아웃 비율을 높인 mock | 대량 알림 발송 | 일시 오류는 재시도되고, 타임아웃 건은 reconcile로 확정되어 같은 clientRef 내역이 2건 이상인 Delivery가 없다 |
| E2E-03 | 대량 알림 발송 중 | 긴급 알림이 발송 가능해진다 | 발송 가능한 긴급 Delivery가 남아 있는 동안 발송 허가를 얻은 요청은 모두 긴급 Delivery를 보낸다 (이미 시작된 대량 요청은 제외) |
| E2E-04 | 워커 여러 개(2개·3개) | 대량 알림 발송 | 429 없이 중복·누락 없이 끝난다 |
| E2E-05 | 워커 여러 개로 발송 중이고 `IN_FLIGHT` 수가 남을 워커들의 동시 발송 수를 넘는다 | 워커 하나를 강제로 멈춘다 | 멈춘 워커의 lease가 만료되어 `UNKNOWN`을 거친 건까지 남은 워커가 이어받아 중복·누락 없이 끝난다 |
| E2E-06 | 대량 알림 발송 중 | 알림을 취소한다 | 새 발송이 멈추고, 이미 나간 건은 `SENT`로 남으며 나머지는 `CANCELLED`가 된다 |
| E2E-07 | 실제 worker 자식 프로세스 | SIGTERM을 보낸다 | readiness가 내려가고 새 claim이 멈추며, 진행 중 요청을 마무리하고 exit 0으로 끝난다 (`enableShutdownHooks`의 `useProcessExit: true`) |
| E2E-08 | 응답하지 않는 발송 API에 요청 중인 실제 worker 자식 프로세스 | SIGTERM을 보낸다 | 제한 시간의 절반이 지나면 요청을 중단해 `UNKNOWN`으로 저장하고, lease를 남기지 않은 채 exit 0으로 끝난다 |
