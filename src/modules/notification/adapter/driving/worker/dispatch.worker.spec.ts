import { setTimeout } from 'node:timers/promises';
import {
  BeforeApplicationShutdown,
  DynamicModule,
  Logger,
  Module,
  OnApplicationShutdown,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, MockInstance, vi } from 'vitest';
import { ShutdownService } from '@/bootstrap/lifecycle/shutdown.service';
import { ReadinessPort } from '@/modules/health/application/port/driven/for-tracking-readiness/readiness.port';
import { InMemoryReadinessAdapter } from '@/modules/health/adapter/driven/process-state/in-memory-readiness.adapter';
import { CompleteSettledAlarmsUseCase } from '@/modules/notification/application/port/driving/for-dispatching-alarms/complete-settled-alarms.use-case';
import {
  AlarmCompletionFailure,
  CompleteSettledAlarmsCommand,
  CompletionScanPosition,
  CompletionScanStart,
  SettledAlarmsPageChecked,
} from '@/modules/notification/application/port/driving/for-dispatching-alarms/complete-settled-alarms.type';
import { ExpandNextPageUseCase } from '@/modules/notification/application/port/driving/for-dispatching-alarms/expand-next-page.use-case';
import { ExpansionPageAttempt } from '@/modules/notification/application/port/driving/for-dispatching-alarms/expand-next-page.type';
import { ReconcileNextDeliveryUseCase } from '@/modules/notification/application/port/driving/for-dispatching-alarms/reconcile-next-delivery.use-case';
import { ReconcileAttempt } from '@/modules/notification/application/port/driving/for-dispatching-alarms/reconcile-next-delivery.type';
import { RecoverExpiredLeaseUseCase } from '@/modules/notification/application/port/driving/for-dispatching-alarms/recover-expired-lease.use-case';
import { RecoveryAttempt } from '@/modules/notification/application/port/driving/for-dispatching-alarms/recover-expired-lease.type';
import { SendNextDeliveryUseCase } from '@/modules/notification/application/port/driving/for-dispatching-alarms/send-next-delivery.use-case';
import { SendAttempt } from '@/modules/notification/application/port/driving/for-dispatching-alarms/send-next-delivery.type';
import { DispatchWorker } from '@/modules/notification/adapter/driving/worker/dispatch.worker';
import { createEnvSchema } from '@/shared/config/env.schema';
import { portSchema } from '@/shared/config/primitive.schema';
import { WorkerShutdownSignalAdapter } from '@/modules/notification/adapter/driven/process-state/worker-shutdown-signal.adapter';
import { TypedConfigModule } from '@/shared/config/typed-config.module';

interface Gate {
  readonly opened: Promise<void>;
  readonly open: () => void;
}

interface ExecutionCounts {
  readonly expansions: number;
  readonly sends: number;
  readonly reconciles: number;
  readonly recoveries: number;
  readonly completionChecks: number;
}

type ShutdownPhase = 'drain-start' | 'drain-end' | 'database-close';

interface PhaseObservation {
  readonly phase: ShutdownPhase;
  readonly sends: number;
  readonly inFlight: number;
  readonly completedSends: number;
}

const DISPATCH_CONCURRENCY: number = 3;
const SHUTDOWN_DRAIN_MS: number = 30;
const SHUTDOWN_TIMEOUT_MS: number = 100;
const POLL_INTERVAL_MS: number = 5;
const COMPLETION_CHECK_INTERVAL_MS: number = 20;

const FIRST_PAGE_END: CompletionScanPosition = {
  createdAt: new Date('2026-10-09T09:00:00.000Z'),
  alarmId: '0b6c1b4e-9a37-4c2a-8d6a-2f6b2d7f1a10',
};

class ExitCalled extends Error {}

const UNCONNECTED_DATABASE_URL: string = 'postgres://app:secret@localhost:5432/notification';

const NOT_YET_OPENED: () => void = (): void => {};

const createGate = (): Gate => {
  let release: () => void = NOT_YET_OPENED;
  const opened: Promise<void> = new Promise<void>((resolve: () => void): void => {
    release = resolve;
  });
  return { opened, open: (): void => release() };
};

class IdleExpansion implements ExpandNextPageUseCase {
  executions: number = 0;

  execute(): Promise<ExpansionPageAttempt> {
    this.executions += 1;
    return Promise.resolve({ kind: 'idle' });
  }
}

class HeldSender implements SendNextDeliveryUseCase {
  executions: number = 0;
  inFlight: number = 0;
  completed: number = 0;
  readonly release: Gate = createGate();

  async execute(): Promise<SendAttempt> {
    this.executions += 1;
    this.inFlight += 1;
    await this.release.opened;
    this.inFlight -= 1;
    this.completed += 1;
    return { kind: 'idle' };
  }
}

class ShutdownPhaseProbe implements BeforeApplicationShutdown, OnApplicationShutdown {
  readonly observations: Array<PhaseObservation> = [];

  constructor(private readonly sender: HeldSender) {}

  async beforeApplicationShutdown(): Promise<void> {
    this.observe('drain-start');
    await setTimeout(POLL_INTERVAL_MS * 4);
    this.observe('drain-end');
  }

  onApplicationShutdown(): void {
    this.observe('database-close');
  }

  private observe(phase: ShutdownPhase): void {
    const { executions, inFlight, completed }: HeldSender = this.sender;
    this.observations.push({ phase, sends: executions, inFlight, completedSends: completed });
  }
}

class NoPermitSender implements SendNextDeliveryUseCase {
  executions: number = 0;

  execute(): Promise<SendAttempt> {
    this.executions += 1;
    return Promise.resolve({ kind: 'no-permit' });
  }
}

class IdleReconcile implements ReconcileNextDeliveryUseCase {
  executions: number = 0;

  execute(): Promise<ReconcileAttempt> {
    this.executions += 1;
    return Promise.resolve({ kind: 'idle' });
  }
}

class IdleRecovery implements RecoverExpiredLeaseUseCase {
  executions: number = 0;

  execute(): Promise<RecoveryAttempt> {
    this.executions += 1;
    return Promise.resolve({ kind: 'idle' });
  }
}

class TwoPageCompletionCheck implements CompleteSettledAlarmsUseCase {
  executions: number = 0;
  readonly starts: Array<CompletionScanStart> = [];

  constructor(private readonly failures: ReadonlyArray<AlarmCompletionFailure> = []) {}

  execute({ start }: Readonly<CompleteSettledAlarmsCommand>): Promise<SettledAlarmsPageChecked> {
    this.executions += 1;
    this.starts.push(start);
    return Promise.resolve({
      kind: 'checked',
      checkedAlarmCount: 100,
      completedAlarmCount: 100,
      failures: this.failures,
      next: start.kind === 'newest' ? { kind: 'more', after: FIRST_PAGE_END } : { kind: 'last' },
    });
  }
}

@Module({})
class ShutdownUnderTestModule {}

@Module({})
class LoopsUnderTestModule {}

describe('DispatchWorker', () => {
  let moduleRef: TestingModule;
  let expansion: IdleExpansion;
  let sender: HeldSender;
  let reconcile: IdleReconcile;
  let recovery: IdleRecovery;
  let completionCheck: TwoPageCompletionCheck;
  let shutdownSignal: WorkerShutdownSignalAdapter;
  let probe: ShutdownPhaseProbe;

  const executionCounts = (): ExecutionCounts => ({
    expansions: expansion.executions,
    sends: sender.executions,
    reconciles: reconcile.executions,
    recoveries: recovery.executions,
    completionChecks: completionCheck.executions,
  });

  const shutdownModule = (): DynamicModule => ({
    module: ShutdownUnderTestModule,
    providers: [
      { provide: ShutdownPhaseProbe, useFactory: (): ShutdownPhaseProbe => probe },
      { provide: ReadinessPort, useClass: InMemoryReadinessAdapter },
      { provide: Pool, useValue: new Pool({ connectionString: UNCONNECTED_DATABASE_URL }) },
      ShutdownService,
    ],
  });

  const loopsModule = (sendUseCase: SendNextDeliveryUseCase): DynamicModule => ({
    module: LoopsUnderTestModule,
    providers: [
      { provide: ExpandNextPageUseCase, useValue: expansion },
      { provide: SendNextDeliveryUseCase, useValue: sendUseCase },
      { provide: ReconcileNextDeliveryUseCase, useValue: reconcile },
      { provide: RecoverExpiredLeaseUseCase, useValue: recovery },
      { provide: CompleteSettledAlarmsUseCase, useValue: completionCheck },
      { provide: WorkerShutdownSignalAdapter, useValue: shutdownSignal },
      DispatchWorker,
    ],
  });

  const compile = (sendUseCase: SendNextDeliveryUseCase): Promise<TestingModule> =>
    Test.createTestingModule({
      imports: [
        TypedConfigModule.forRoot(createEnvSchema(portSchema.parse(3001))),
        loopsModule(sendUseCase),
        shutdownModule(),
      ],
    }).compile();

  beforeEach(async (): Promise<void> => {
    vi.stubEnv('DATABASE_URL', UNCONNECTED_DATABASE_URL);
    vi.stubEnv('SHUTDOWN_DRAIN_MS', String(SHUTDOWN_DRAIN_MS));
    vi.stubEnv('SHUTDOWN_TIMEOUT_MS', String(SHUTDOWN_TIMEOUT_MS));
    vi.stubEnv('DISPATCH_CONCURRENCY', String(DISPATCH_CONCURRENCY));
    vi.stubEnv('WORKER_POLL_INTERVAL_MS', String(POLL_INTERVAL_MS));
    vi.stubEnv('COMPLETION_CHECK_INTERVAL_MS', String(COMPLETION_CHECK_INTERVAL_MS));
    expansion = new IdleExpansion();
    sender = new HeldSender();
    reconcile = new IdleReconcile();
    recovery = new IdleRecovery();
    completionCheck = new TwoPageCompletionCheck();
    shutdownSignal = new WorkerShutdownSignalAdapter();
    probe = new ShutdownPhaseProbe(sender);
    moduleRef = await compile(sender);
  });

  afterEach(async (): Promise<void> => {
    vi.useRealTimers();
    sender.release.open();
    await moduleRef.close();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('WRK-01 워커 모듈 / 애플리케이션 부트스트랩이 끝난다 → 확장 · 발송 · reconcile · lease 복구 · 완료 확인 루프가 시작된다', async (): Promise<void> => {
    await moduleRef.init();

    await vi.waitFor((): void => {
      expect(expansion.executions).toBeGreaterThanOrEqual(2);
      expect(reconcile.executions).toBeGreaterThanOrEqual(2);
      expect(recovery.executions).toBeGreaterThanOrEqual(2);
      expect(completionCheck.executions).toBeGreaterThanOrEqual(1);
      expect(sender.inFlight).toBe(DISPATCH_CONCURRENCY);
    });
  });

  it('WRK-02 실행 중인 워커 / 종료 신호를 받는다 → 새 claim을 즉시 멈추고 readiness를 내린다 (워커 모듈이 종료 모듈보다 먼저 import돼도 drain 대기 전에 멈춘다)', async (): Promise<void> => {
    const readiness: ReadinessPort = moduleRef.get(ReadinessPort);
    await moduleRef.init();
    await vi.waitFor((): void => {
      expect(sender.inFlight).toBe(DISPATCH_CONCURRENCY);
    });

    moduleRef.get(ShutdownService).handleSignal('SIGTERM');
    const acceptingTrafficAfterSignal: boolean = readiness.isAcceptingTraffic();
    const closing: Promise<void> = moduleRef.close();
    await setTimeout(POLL_INTERVAL_MS * 4);
    sender.release.open();
    await closing;

    expect(acceptingTrafficAfterSignal).toBe(false);
    expect(shutdownSignal.isRequested()).toBe(true);
    expect(
      probe.observations.filter(
        ({ phase }: PhaseObservation): boolean => phase !== 'database-close',
      ),
    ).toEqual([
      {
        phase: 'drain-start',
        sends: DISPATCH_CONCURRENCY,
        inFlight: 0,
        completedSends: DISPATCH_CONCURRENCY,
      },
      {
        phase: 'drain-end',
        sends: DISPATCH_CONCURRENCY,
        inFlight: 0,
        completedSends: DISPATCH_CONCURRENCY,
      },
    ]);
  });

  it('WRK-04 제한 시간 안에 끝나지 않는 요청 / 종료 절차가 진행된다 → 요청을 중단하고 lease를 남겨 둔 채 종료하며, 남은 건은 lease 만료 후 다른 워커가 reconcile한다 (결과를 저장하지 않은 채 exit(1), 복구·reconcile은 UC-15)', async (): Promise<void> => {
    const exit: MockInstance<typeof process.exit> = vi
      .spyOn(process, 'exit')
      .mockImplementation((): never => {
        throw new ExitCalled();
      });
    vi.spyOn(Logger.prototype, 'error').mockImplementation((): void => {});
    await moduleRef.init();
    await vi.waitFor((): void => {
      expect(sender.inFlight).toBe(DISPATCH_CONCURRENCY);
    });

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    moduleRef.get(ShutdownService).handleSignal('SIGTERM');
    const closing: Promise<void> = moduleRef.close();

    expect(() => vi.advanceTimersByTime(SHUTDOWN_DRAIN_MS + SHUTDOWN_TIMEOUT_MS)).toThrow(
      ExitCalled,
    );
    expect(exit).toHaveBeenCalledWith(1);
    expect(sender.completed).toBe(0);
    vi.useRealTimers();
    sender.release.open();
    await closing;
  });

  it('부트스트랩 전에는 어떤 루프도 실행하지 않는다', async (): Promise<void> => {
    await setTimeout(POLL_INTERVAL_MS * 4);

    expect(executionCounts()).toEqual({
      expansions: 0,
      sends: 0,
      reconciles: 0,
      recoveries: 0,
      completionChecks: 0,
    });
  });

  it('WRK-03 진행 중인 요청이 있는 워커 / 종료 절차가 진행된다 → 진행 중 요청의 결과를 제한 시간 안에 저장한 뒤 DB 연결을 닫는다', async (): Promise<void> => {
    await moduleRef.init();
    await vi.waitFor((): void => {
      expect(sender.inFlight).toBe(DISPATCH_CONCURRENCY);
    });

    const closing: Promise<void> = moduleRef.close();
    sender.release.open();
    await closing;
    const countsAtClose: ExecutionCounts = executionCounts();
    await setTimeout(POLL_INTERVAL_MS * 4);

    expect(
      probe.observations.find(({ phase }: PhaseObservation): boolean => phase === 'database-close'),
    ).toEqual({
      phase: 'database-close',
      sends: DISPATCH_CONCURRENCY,
      inFlight: 0,
      completedSends: DISPATCH_CONCURRENCY,
    });
    expect(executionCounts()).toEqual(countsAtClose);
  });

  it('발송 허가를 얻지 못하면 쉬는 간격을 두고 다시 시도한다', async (): Promise<void> => {
    const noPermitSender: NoPermitSender = new NoPermitSender();
    const noPermitModule: TestingModule = await compile(noPermitSender);
    const observedMs: number = POLL_INTERVAL_MS * 10;

    await noPermitModule.init();
    await setTimeout(observedMs);
    await noPermitModule.close();

    expect(noPermitSender.executions).toBeGreaterThanOrEqual(DISPATCH_CONCURRENCY);
    expect(noPermitSender.executions).toBeLessThanOrEqual(
      DISPATCH_CONCURRENCY * (observedMs / POLL_INTERVAL_MS + 1),
    );
  });

  it('완료 확인은 다음 페이지가 있으면 바로 이어서 확인하고, 마지막 페이지 뒤에는 간격을 두고 처음부터 다시 확인한다', async (): Promise<void> => {
    const observedMs: number = COMPLETION_CHECK_INTERVAL_MS * 5;

    await moduleRef.init();
    await setTimeout(observedMs);
    sender.release.open();
    await moduleRef.close();

    expect(completionCheck.starts.slice(0, 3)).toEqual([
      { kind: 'newest' },
      { kind: 'after', position: FIRST_PAGE_END },
      { kind: 'newest' },
    ]);
    expect(completionCheck.executions).toBeLessThanOrEqual(
      2 * (observedMs / COMPLETION_CHECK_INTERVAL_MS + 1),
    );
  });

  it('완료 판정에 실패한 알림이 있으면 경고 로그로 남기고 확인을 이어간다', async (): Promise<void> => {
    const warnLog: MockInstance<Logger['warn']> = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation((): void => {});
    completionCheck = new TwoPageCompletionCheck([
      { alarmId: '0b6c1b4e-9a37-4c2a-8d6a-2f6b2d7f1a10', reason: 'database connection reset' },
    ]);
    const failingModule: TestingModule = await compile(sender);

    await failingModule.init();
    await vi.waitFor((): void => {
      expect(completionCheck.executions).toBeGreaterThanOrEqual(2);
    });
    sender.release.open();
    await failingModule.close();

    expect(warnLog).toHaveBeenCalledWith(
      'completion check failed for alarm 0b6c1b4e-9a37-4c2a-8d6a-2f6b2d7f1a10: database connection reset',
    );
  });
});
