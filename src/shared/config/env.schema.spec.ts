import { describe, expect, it } from 'vitest';
import { createEnvSchema } from '@/shared/config/env.schema';
import { Env, EnvSchema, RawEnv } from '@/shared/config/env.type';
import { EnvValidator } from '@/shared/config/env.validator';
import { portSchema } from '@/shared/config/primitive.schema';

type Validate = (raw: RawEnv) => Env;

type EnvSnapshot = Readonly<Record<keyof Env, string | number>>;

type WorkerSettingCase = Readonly<[key: string, rawValue: string]>;

type ShutdownTimingCase = Readonly<[drainMs: string, timeoutMs: string]>;

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
      DATABASE_POOL_MAX: 20,
      MOCK_API_URL: 'http://localhost:4000',
      DISPATCH_MAX_REQUEST_MS: 5000,
      DISPATCH_LEASE_MS: 30000,
      RECONCILE_DELAY_MS: 35000,
      RETRY_MAX_ATTEMPTS: 5,
      RETRY_BASE_DELAY_MS: 1000,
      RETRY_MAX_DELAY_MS: 60000,
      LOOKUP_RETRY_BASE_DELAY_MS: 5000,
      LOOKUP_RETRY_MAX_DELAY_MS: 60000,
      UNCONFIRMED_AFTER_MS: 3600000,
      USER_PAGE_LIMIT: 1000,
      RATE_LIMIT_INTERVAL_MS: 21,
      DISPATCH_CONCURRENCY: 8,
      WORKER_POLL_INTERVAL_MS: 100,
      WORKER_ERROR_DELAY_MS: 1000,
      COMPLETION_CHECK_INTERVAL_MS: 1000,
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
      DATABASE_POOL_MAX: '30',
      MOCK_API_URL: 'http://mock:4000',
      DISPATCH_MAX_REQUEST_MS: '3000',
      DISPATCH_LEASE_MS: '20000',
      RECONCILE_DELAY_MS: '40000',
      RETRY_MAX_ATTEMPTS: '3',
      RETRY_BASE_DELAY_MS: '500',
      RETRY_MAX_DELAY_MS: '30000',
      LOOKUP_RETRY_BASE_DELAY_MS: '2000',
      LOOKUP_RETRY_MAX_DELAY_MS: '20000',
      UNCONFIRMED_AFTER_MS: '600000',
      USER_PAGE_LIMIT: '500',
      RATE_LIMIT_INTERVAL_MS: '25',
      DISPATCH_CONCURRENCY: '4',
      WORKER_POLL_INTERVAL_MS: '50',
      WORKER_ERROR_DELAY_MS: '2000',
      COMPLETION_CHECK_INTERVAL_MS: '3000',
    };
    const expected: EnvSnapshot = {
      HOST: '127.0.0.1',
      PORT: 8080,
      SHUTDOWN_DRAIN_MS: 0,
      SHUTDOWN_TIMEOUT_MS: 1000,
      LOG_LEVEL: 'debug',
      LOG_FORMAT: 'json',
      DATABASE_URL,
      DATABASE_POOL_MAX: 30,
      MOCK_API_URL: 'http://mock:4000',
      DISPATCH_MAX_REQUEST_MS: 3000,
      DISPATCH_LEASE_MS: 20000,
      RECONCILE_DELAY_MS: 40000,
      RETRY_MAX_ATTEMPTS: 3,
      RETRY_BASE_DELAY_MS: 500,
      RETRY_MAX_DELAY_MS: 30000,
      LOOKUP_RETRY_BASE_DELAY_MS: 2000,
      LOOKUP_RETRY_MAX_DELAY_MS: 20000,
      UNCONFIRMED_AFTER_MS: 600000,
      USER_PAGE_LIMIT: 500,
      RATE_LIMIT_INTERVAL_MS: 25,
      DISPATCH_CONCURRENCY: 4,
      WORKER_POLL_INTERVAL_MS: 50,
      WORKER_ERROR_DELAY_MS: 2000,
      COMPLETION_CHECK_INTERVAL_MS: 3000,
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

  it.each<ShutdownTimingCase>([
    ['2147483648', '1'],
    ['0', '2147483648'],
    ['2147483647', '1'],
    ['1', '2147483647'],
    ['2000000000', '2000000000'],
  ])(
    'CFG-01 종료 설정이나 합계가 Node 타이머 상한을 넘으면 거부한다 (drain=%s, timeout=%s)',
    (drainMs: string, timeoutMs: string): void => {
      expect((): Env =>
        validate({
          ...REQUIRED,
          SHUTDOWN_DRAIN_MS: drainMs,
          SHUTDOWN_TIMEOUT_MS: timeoutMs,
        }),
      ).toThrow(/SHUTDOWN_(DRAIN|TIMEOUT)_MS/);
    },
  );

  it.each<ShutdownTimingCase>([
    ['0', '1'],
    ['0', '2147483647'],
    ['2147483646', '1'],
    ['1', '2147483646'],
  ])(
    'CFG-02 drain 0과 합계가 Node 타이머 상한 이하인 종료 설정을 허용한다 (drain=%s, timeout=%s)',
    (drainMs: string, timeoutMs: string): void => {
      const { SHUTDOWN_DRAIN_MS, SHUTDOWN_TIMEOUT_MS }: Env = validate({
        ...REQUIRED,
        SHUTDOWN_DRAIN_MS: drainMs,
        SHUTDOWN_TIMEOUT_MS: timeoutMs,
      });

      expect(SHUTDOWN_DRAIN_MS).toBe(Number(drainMs));
      expect(SHUTDOWN_TIMEOUT_MS).toBe(Number(timeoutMs));
    },
  );

  it('CFG-03 일반 기간 설정에는 Node 타이머 상한을 적용하지 않는다', (): void => {
    const { DISPATCH_LEASE_MS, UNCONFIRMED_AFTER_MS }: Env = validate({
      ...REQUIRED,
      DISPATCH_LEASE_MS: '2147483648',
      UNCONFIRMED_AFTER_MS: '2147483648',
    });

    expect(DISPATCH_LEASE_MS).toBe(2_147_483_648);
    expect(UNCONFIRMED_AFTER_MS).toBe(2_147_483_648);
  });

  it('CFG-04 DATABASE_POOL_MAX를 지정하지 않으면 워커 루프와 헬스 검사를 함께 감당하도록 Pool 최대 연결 수를 20으로 둔다', (): void => {
    const { DATABASE_POOL_MAX }: Env = validate(REQUIRED);

    expect(DATABASE_POOL_MAX).toBe(20);
  });

  it.each(['', '0', '-1', '1.5', 'abc'])(
    'CFG-05 양의 정수가 아닌 DATABASE_POOL_MAX="%s"는 거부한다',
    (rawPoolMax: string): void => {
      expect((): Env => validate({ ...REQUIRED, DATABASE_POOL_MAX: rawPoolMax })).toThrow(
        /DATABASE_POOL_MAX/,
      );
    },
  );

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

  it.each(['', 'not a url', 'ftp://mock:4000', 'postgres://mock:4000'])(
    'http(s) URL이 아닌 MOCK_API_URL="%s"는 거부한다',
    (url: string): void => {
      expect(() => validate({ ...REQUIRED, MOCK_API_URL: url })).toThrow(/MOCK_API_URL/);
    },
  );

  it.each<WorkerSettingCase>([
    ['DISPATCH_MAX_REQUEST_MS', '0'],
    ['DISPATCH_LEASE_MS', '0'],
    ['RECONCILE_DELAY_MS', '0'],
    ['RETRY_MAX_ATTEMPTS', '0'],
    ['RETRY_BASE_DELAY_MS', '0'],
    ['RETRY_MAX_DELAY_MS', '0'],
    ['LOOKUP_RETRY_BASE_DELAY_MS', '0'],
    ['LOOKUP_RETRY_MAX_DELAY_MS', '0'],
    ['UNCONFIRMED_AFTER_MS', '0'],
    ['USER_PAGE_LIMIT', '0'],
    ['RATE_LIMIT_INTERVAL_MS', '0'],
    ['RETRY_MAX_ATTEMPTS', '1.5'],
    ['DISPATCH_CONCURRENCY', '0'],
    ['WORKER_POLL_INTERVAL_MS', '0'],
    ['WORKER_ERROR_DELAY_MS', '0'],
    ['COMPLETION_CHECK_INTERVAL_MS', '0'],
    ['WORKER_POLL_INTERVAL_MS', '2147483648'],
  ])('워커 설정 %s="%s"는 거부한다', (key: string, rawValue: string): void => {
    expect(() => validate({ ...REQUIRED, [key]: rawValue })).toThrow(new RegExp(key));
  });
});
