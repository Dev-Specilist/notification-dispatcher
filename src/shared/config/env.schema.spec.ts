import { describe, expect, it } from 'vitest';
import { createEnvSchema } from '@/shared/config/env.schema';
import { Env, EnvSchema, RawEnv } from '@/shared/config/env.type';
import { EnvValidator } from '@/shared/config/env.validator';
import { portSchema } from '@/shared/config/primitive.schema';

type Validate = (raw: RawEnv) => Env;

type EnvSnapshot = Readonly<Record<keyof Env, string | number>>;

const DATABASE_URL: string = 'postgres://app:secret@localhost:5432/notification';

const REQUIRED: RawEnv = { DATABASE_URL };

describe('환경변수 스키마', () => {
  const schema: EnvSchema = createEnvSchema(portSchema.parse(3000));
  const validate: Validate = EnvValidator.for(schema);

  it('필수값(DATABASE_URL)만 주면 나머지는 기본값을 사용한다', () => {
    const expected: EnvSnapshot = {
      HOST: '0.0.0.0',
      PORT: 3000,
      SHUTDOWN_DRAIN_MS: 5000,
      SHUTDOWN_TIMEOUT_MS: 25000,
      LOG_LEVEL: 'log',
      LOG_FORMAT: 'pretty',
      DATABASE_URL,
    };

    expect(validate(REQUIRED)).toEqual(expected);
  });

  it('프로세스별로 지정한 기본 포트를 사용한다', () => {
    const { PORT }: Env = EnvValidator.for(createEnvSchema(portSchema.parse(3001)))(REQUIRED);

    expect(PORT).toBe(3001);
  });

  it('문자열 env 값을 타입에 맞게 변환한다', () => {
    const raw: RawEnv = {
      ...REQUIRED,
      HOST: '127.0.0.1',
      PORT: '8080',
      SHUTDOWN_DRAIN_MS: '0',
      SHUTDOWN_TIMEOUT_MS: '1000',
      LOG_LEVEL: 'debug',
      LOG_FORMAT: 'json',
    };
    const expected: EnvSnapshot = {
      HOST: '127.0.0.1',
      PORT: 8080,
      SHUTDOWN_DRAIN_MS: 0,
      SHUTDOWN_TIMEOUT_MS: 1000,
      LOG_LEVEL: 'debug',
      LOG_FORMAT: 'json',
      DATABASE_URL,
    };

    expect(validate(raw)).toEqual(expected);
  });

  it.each(['', 'abc', '0', '70000', '1.5'])('잘못된 PORT="%s"는 거부한다', (port: string) => {
    expect(() => validate({ PORT: port })).toThrow(/PORT/);
  });

  it.each(['', '0'])('SHUTDOWN_TIMEOUT_MS="%s"는 거부한다', (timeout: string) => {
    expect(() => validate({ SHUTDOWN_TIMEOUT_MS: timeout })).toThrow(/SHUTDOWN_TIMEOUT_MS/);
  });

  it('음수 SHUTDOWN_DRAIN_MS는 거부한다', () => {
    expect(() => validate({ SHUTDOWN_DRAIN_MS: '-5' })).toThrow(/SHUTDOWN_DRAIN_MS/);
  });

  it('알 수 없는 LOG_LEVEL은 거부한다', () => {
    expect(() => validate({ LOG_LEVEL: 'trace' })).toThrow(/LOG_LEVEL/);
  });

  it('알 수 없는 LOG_FORMAT은 거부한다', () => {
    expect(() => validate({ LOG_FORMAT: 'xml' })).toThrow(/LOG_FORMAT/);
  });

  it('DATABASE_URL이 없으면 거부한다 (접속 정보 기본값을 두지 않는다)', (): void => {
    expect(() => validate({})).toThrow(/DATABASE_URL/);
  });

  it.each(['postgres://app:secret@db:5432/notification', 'postgresql://localhost/notification'])(
    'PostgreSQL URL "%s"는 허용한다',
    (url: string): void => {
      expect(validate({ DATABASE_URL: url }).DATABASE_URL).toBe(url);
    },
  );

  it.each(['', 'not a url', 'mysql://localhost/notification', 'http://localhost:5432'])(
    'PostgreSQL URL이 아닌 DATABASE_URL="%s"는 거부한다',
    (url: string): void => {
      expect(() => validate({ DATABASE_URL: url })).toThrow(/DATABASE_URL/);
    },
  );
});
