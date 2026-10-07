import { describe, it } from 'vitest';

describe('MockMessageSender', () => {
  it.todo('EXT-02 mock 발송 API / 정상 발송 → Accepted(messageId) 결과가 나온다');
  it.todo('EXT-03 수신 거부 사용자 / 발송 → PermanentFailure(RECIPIENT_BLOCKED) 결과가 나온다');
  it.todo(
    'EXT-04 RATE_LIMIT을 낮춘 mock / 한도를 넘겨 발송 → RateLimited(retryAfterMs) 결과가 나온다',
  );
  it.todo('EXT-05 ERROR_RATE=1 mock / 발송 → TransientFailure 결과가 나온다');
  it.todo('EXT-06 TIMEOUT_RATE=1 mock / 발송 → 클라이언트 타임아웃 후 Unknown 결과가 나온다');
  it.todo('EXT-07 이미 발송된 clientRef / 발송 내역을 조회한다 → messageId가 담긴 내역이 나온다');
  it.todo('EXT-08 발송하지 않은 clientRef / 발송 내역을 조회한다 → 빈 내역이 나온다');
  it.todo(
    'EXT-09 조회 API가 오류를 내거나 스키마와 다른 응답을 준다 / 발송 내역을 조회한다 → 빈 내역이 아니라 LookupFailed 결과가 나온다',
  );
  it.todo(
    'EXT-10 기본 RATE_LIMIT mock / 제한기를 거쳐 2초 동안 연속 발송한다 → 429가 나오지 않는다 (mock 한도 구간 방식에 대한 특성 테스트)',
  );
  it.todo(
    'EXT-11 TIMEOUT_RATE=1 mock / 발송 요청 직후 응답을 기다리는 동안 발송 내역을 조회한다 → 내역이 이미 있다 (발송 기록 시점에 대한 특성 테스트, reconcile 가정의 근거)',
  );
});
