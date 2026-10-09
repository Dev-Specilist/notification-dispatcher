import { describe, expect, it } from 'vitest';
import { ThrownValues } from '@/shared/error/thrown-value.util';

describe('ThrownValues', () => {
  it('Error는 같은 객체를 그대로 돌려준다', (): void => {
    const thrownError: Error = new TypeError('fetch failed');

    expect(ThrownValues.toError(thrownError)).toBe(thrownError);
  });

  it('Error가 아닌 값은 문자열로 바꾼 message를 가진 Error로 감싼다', (): void => {
    const wrappedError: Error = ThrownValues.toError('connection reset');

    expect(wrappedError).toBeInstanceOf(Error);
    expect(wrappedError.message).toBe('connection reset');
  });
});
