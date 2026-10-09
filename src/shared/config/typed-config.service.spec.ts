import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { LogLevel } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createEnvSchema } from '@/shared/config/env.schema';
import { Host, Milliseconds, Port, portSchema } from '@/shared/config/primitive.schema';
import { DatabaseUrl, TimerDelayMs } from '@/shared/config/primitive.type';
import { TypedConfigModule } from '@/shared/config/typed-config.module';
import { TypedConfigService } from '@/shared/config/typed-config.service';
import { LogFormat } from '@/shared/logging/logging.schema';

describe('TypedConfigService', () => {
  let moduleRef: TestingModule;
  let config: TypedConfigService;

  beforeEach(async (): Promise<void> => {
    vi.stubEnv('PORT', '4000');
    vi.stubEnv('LOG_LEVEL', 'debug');
    vi.stubEnv('DATABASE_URL', 'postgres://app:secret@localhost:5432/notification');
    moduleRef = await Test.createTestingModule({
      imports: [TypedConfigModule.forRoot(createEnvSchema(portSchema.parse(3000)))],
    }).compile();
    config = moduleRef.get(TypedConfigService);
  });

  afterEach(async (): Promise<void> => {
    await moduleRef.close();
    vi.unstubAllEnvs();
  });

  it('스키마로 검증하고 변환한 값을 반환한다', () => {
    expect(config.get('PORT')).toBe(4000);
    expect(config.get('LOG_LEVEL')).toBe('debug');
  });

  it('키마다 스키마의 도메인 타입을 추론한다', () => {
    expectTypeOf(config.get('PORT')).toEqualTypeOf<Port>();
    expectTypeOf(config.get('HOST')).toEqualTypeOf<Host>();
    expectTypeOf(config.get('SHUTDOWN_DRAIN_MS')).toEqualTypeOf<Milliseconds>();
    expectTypeOf(config.get('SHUTDOWN_TIMEOUT_MS')).toEqualTypeOf<TimerDelayMs>();
    expectTypeOf(config.get('LOG_LEVEL')).toExtend<LogLevel>();
    expectTypeOf(config.get('LOG_FORMAT')).toEqualTypeOf<LogFormat>();
    expectTypeOf(config.get('DATABASE_URL')).toEqualTypeOf<DatabaseUrl>();
  });

  it('검증을 거치지 않은 원시 값은 도메인 타입 자리에 들어갈 수 없다', () => {
    expectTypeOf<number>().not.toExtend<Port>();
    expectTypeOf<string>().not.toExtend<Host>();
    expectTypeOf<number>().not.toExtend<Milliseconds>();
  });
});
