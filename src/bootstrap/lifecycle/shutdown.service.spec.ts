import { afterEach, beforeEach, describe, expect, it, MockInstance, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { ShutdownService } from '@/bootstrap/lifecycle/shutdown.service';
import { ReadinessPort } from '@/modules/health/application/port/readiness.port';
import { InMemoryReadinessAdapter } from '@/modules/health/infrastructure/adapter/in-memory-readiness.adapter';
import { createEnvSchema } from '@/shared/config/env.schema';
import { portSchema } from '@/shared/config/primitive.schema';
import { TypedConfigModule } from '@/shared/config/typed-config.module';

type ExitSpy = MockInstance<typeof process.exit>;

class ExitCalled extends Error {}

const DRAIN_MS: number = 30;
const TIMEOUT_MS: number = 1000;

describe('ShutdownService', () => {
  let moduleRef: TestingModule;
  let readiness: ReadinessPort;
  let shutdown: ShutdownService;
  let exit: ExitSpy;

  beforeEach(async (): Promise<void> => {
    vi.stubEnv('SHUTDOWN_DRAIN_MS', String(DRAIN_MS));
    vi.stubEnv('SHUTDOWN_TIMEOUT_MS', String(TIMEOUT_MS));
    vi.stubEnv('DATABASE_URL', 'postgres://app:secret@localhost:5432/notification');
    moduleRef = await Test.createTestingModule({
      imports: [TypedConfigModule.forRoot(createEnvSchema(portSchema.parse(3000)))],
      providers: [{ provide: ReadinessPort, useClass: InMemoryReadinessAdapter }, ShutdownService],
    }).compile();
    readiness = moduleRef.get(ReadinessPort);
    shutdown = moduleRef.get(ShutdownService);
    exit = vi.spyOn(process, 'exit').mockImplementation((): never => {
      throw new ExitCalled();
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(async (): Promise<void> => {
    vi.useRealTimers();
    shutdown.onApplicationShutdown();
    await moduleRef.close();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('종료 훅이 시작되면 readiness를 즉시 내리고 drain 시간이 지나야 끝난다', async (): Promise<void> => {
    let drained: boolean = false;

    const draining: Promise<void> = shutdown.beforeApplicationShutdown('close').then((): void => {
      drained = true;
    });
    expect(readiness.isAcceptingTraffic()).toBe(false);

    await vi.advanceTimersByTimeAsync(DRAIN_MS - 1);
    expect(drained).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await draining;
    expect(drained).toBe(true);
  });

  it('종료 신호를 받으면 다른 종료 훅을 기다리지 않고 readiness를 내린다', () => {
    shutdown.handleSignal('SIGTERM');

    expect(readiness.isAcceptingTraffic()).toBe(false);
  });

  it('종료 신호 후 drain과 timeout을 합한 시간 안에 끝나지 않으면 exit(1)로 강제 종료한다', () => {
    shutdown.handleSignal('SIGTERM');

    vi.advanceTimersByTime(DRAIN_MS + TIMEOUT_MS - 1);
    expect(exit).not.toHaveBeenCalled();

    expect(() => vi.advanceTimersByTime(1)).toThrow(ExitCalled);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('종료 신호를 여러 번 받아도 강제 종료 타이머는 한 번만 시작한다', () => {
    shutdown.handleSignal('SIGTERM');
    shutdown.handleSignal('SIGINT');

    expect(vi.getTimerCount()).toBe(1);
  });

  it('정상 종료가 끝나면 제한 시간이 지나도 강제 종료하지 않는다', () => {
    shutdown.handleSignal('SIGTERM');
    shutdown.onApplicationShutdown();

    vi.advanceTimersByTime(DRAIN_MS + TIMEOUT_MS);

    expect(exit).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('신호 없이 close되면 강제 종료 타이머를 시작하지 않는다', async (): Promise<void> => {
    const draining: Promise<void> = shutdown.beforeApplicationShutdown('close');
    await vi.advanceTimersByTimeAsync(DRAIN_MS);
    await draining;

    vi.advanceTimersByTime(DRAIN_MS + TIMEOUT_MS);
    expect(exit).not.toHaveBeenCalled();
  });

  it('부트스트랩 시 종료 신호 리스너를 등록하고 종료 시 해제한다', () => {
    const before: number = process.listenerCount('SIGTERM');

    shutdown.onApplicationBootstrap();
    expect(process.listenerCount('SIGTERM')).toBe(before + 1);

    shutdown.onApplicationShutdown();
    expect(process.listenerCount('SIGTERM')).toBe(before);
  });

  it('Nest 종료 hook과 같은 종료 신호 목록을 공개한다', () => {
    expect(ShutdownService.SIGNALS).toEqual(['SIGTERM', 'SIGINT']);
  });
});
