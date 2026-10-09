import { describe, expect, it } from 'vitest';
import {
  hostSchema,
  millisecondsSchema,
  portSchema,
  positiveMillisecondsSchema,
  processRoleSchema,
  timerDelayMsSchema,
  timerDelayOrZeroMsSchema,
} from '@/shared/config/primitive.schema';

describe('primitive 스키마', () => {
  it.each(['', '  ', '0', '65536', '1.5', 'abc'])('잘못된 포트 "%s"는 거부한다', (raw: string) => {
    expect(portSchema.safeParse(raw).success).toBe(false);
  });

  it('문자열 포트를 숫자 Port로 변환한다', () => {
    expect(portSchema.parse('8080')).toBe(8080);
  });

  it('빈 호스트는 거부한다', () => {
    expect(hostSchema.safeParse('').success).toBe(false);
  });

  it.each(['', '-1', '1.5'])('잘못된 밀리초 "%s"는 거부한다', (raw: string) => {
    expect(millisecondsSchema.safeParse(raw).success).toBe(false);
  });

  it('밀리초는 0을 허용한다', () => {
    expect(millisecondsSchema.parse('0')).toBe(0);
  });

  it.each(['', '0', '-1'])('양수 밀리초는 "%s"를 거부한다', (raw: string) => {
    expect(positiveMillisecondsSchema.safeParse(raw).success).toBe(false);
  });

  it.each(['0', '1.5', '2147483648'])(
    '타이머 대기 밀리초는 0이거나 Node 타이머 상한을 넘거나 정수가 아닌 "%s"를 거부한다',
    (raw: string): void => {
      expect(timerDelayMsSchema.safeParse(raw).success).toBe(false);
    },
  );

  it.each([
    ['1', 1],
    ['2147483647', 2_147_483_647],
  ])(
    '타이머 대기 밀리초는 1부터 Node 타이머 상한까지 허용한다 ("%s")',
    (raw: string, delayMs: number): void => {
      expect(timerDelayMsSchema.parse(raw)).toBe(delayMs);
    },
  );

  it.each(['-1', '1.5', '2147483648'])(
    '0을 허용하는 타이머 대기 밀리초는 음수·소수·Node 타이머 상한 초과 "%s"를 거부한다',
    (raw: string): void => {
      expect(timerDelayOrZeroMsSchema.safeParse(raw).success).toBe(false);
    },
  );

  it.each([
    ['0', 0],
    ['2147483647', 2_147_483_647],
  ])(
    '0을 허용하는 타이머 대기 밀리초는 0부터 Node 타이머 상한까지 허용한다 ("%s")',
    (raw: string, delayMs: number): void => {
      expect(timerDelayOrZeroMsSchema.parse(raw)).toBe(delayMs);
    },
  );

  it('프로세스 역할은 api, worker, migrate만 허용한다', (): void => {
    expect(processRoleSchema.options).toEqual(['api', 'worker', 'migrate']);
  });
});
