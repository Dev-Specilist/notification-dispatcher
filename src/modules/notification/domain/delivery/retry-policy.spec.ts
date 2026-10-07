import { describe, it } from 'vitest';

describe('RetryPolicy', () => {
  it.todo(
    'DLV-05 IN_FLIGHT Delivery / 500/503을 받는다 → RETRY_WAIT가 되고 지수 백오프(+jitter)로 다음 시도 시각이 정해진다',
  );
  it.todo(
    'DLV-06 최대 시도 횟수에 도달한 Delivery / 500/503을 받는다 → FAILED(RETRY_EXHAUSTED)가 된다',
  );
});
