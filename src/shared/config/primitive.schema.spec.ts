import { describe, expect, it } from 'vitest';
import {
  hostSchema,
  millisecondsSchema,
  portSchema,
  positiveMillisecondsSchema,
  processRoleSchema,
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

  it('프로세스 역할은 api, worker, migrate만 허용한다', (): void => {
    expect(processRoleSchema.options).toEqual(['api', 'worker', 'migrate']);
  });
});
