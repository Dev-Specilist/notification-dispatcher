import { setTimeout } from 'node:timers/promises';
import { Test, TestingModule } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpandNextPageUseCase } from '@/modules/notification/application/port/in/expand-next-page.use-case';
import { ExpansionPageAttempt } from '@/modules/notification/application/port/in/expand-next-page.type';
import { ReconcileNextDeliveryUseCase } from '@/modules/notification/application/port/in/reconcile-next-delivery.use-case';
import { ReconcileAttempt } from '@/modules/notification/application/port/in/reconcile-next-delivery.type';
import { RecoverExpiredLeaseUseCase } from '@/modules/notification/application/port/in/recover-expired-lease.use-case';
import { RecoveryAttempt } from '@/modules/notification/application/port/in/recover-expired-lease.type';
import { SendNextDeliveryUseCase } from '@/modules/notification/application/port/in/send-next-delivery.use-case';
import { SendAttempt } from '@/modules/notification/application/port/in/send-next-delivery.type';
import { DispatchWorker } from '@/modules/notification/adapter/in/worker/dispatch.worker';
import { createEnvSchema } from '@/shared/config/env.schema';
import { portSchema } from '@/shared/config/primitive.schema';
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
}

const DISPATCH_CONCURRENCY: number = 3;
const POLL_INTERVAL_MS: number = 5;

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
  readonly release: Gate = createGate();

  async execute(): Promise<SendAttempt> {
    this.executions += 1;
    this.inFlight += 1;
    await this.release.opened;
    this.inFlight -= 1;
    return { kind: 'idle' };
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

describe('DispatchWorker', () => {
  let moduleRef: TestingModule;
  let expansion: IdleExpansion;
  let sender: HeldSender;
  let reconcile: IdleReconcile;
  let recovery: IdleRecovery;

  const executionCounts = (): ExecutionCounts => ({
    expansions: expansion.executions,
    sends: sender.executions,
    reconciles: reconcile.executions,
    recoveries: recovery.executions,
  });

  const compile = (sendUseCase: SendNextDeliveryUseCase): Promise<TestingModule> =>
    Test.createTestingModule({
      imports: [TypedConfigModule.forRoot(createEnvSchema(portSchema.parse(3001)))],
      providers: [
        { provide: ExpandNextPageUseCase, useValue: expansion },
        { provide: SendNextDeliveryUseCase, useValue: sendUseCase },
        { provide: ReconcileNextDeliveryUseCase, useValue: reconcile },
        { provide: RecoverExpiredLeaseUseCase, useValue: recovery },
        DispatchWorker,
      ],
    }).compile();

  beforeEach(async (): Promise<void> => {
    vi.stubEnv('DATABASE_URL', 'postgres://app:secret@localhost:5432/notification');
    vi.stubEnv('DISPATCH_CONCURRENCY', String(DISPATCH_CONCURRENCY));
    vi.stubEnv('WORKER_POLL_INTERVAL_MS', String(POLL_INTERVAL_MS));
    expansion = new IdleExpansion();
    sender = new HeldSender();
    reconcile = new IdleReconcile();
    recovery = new IdleRecovery();
    moduleRef = await compile(sender);
  });

  afterEach(async (): Promise<void> => {
    sender.release.open();
    await moduleRef.close();
    vi.unstubAllEnvs();
  });

  it('WRK-01 워커 모듈 / 애플리케이션 부트스트랩이 끝난다 → 확장 · 발송 · reconcile · lease 복구 루프가 시작된다', async (): Promise<void> => {
    await moduleRef.init();

    await vi.waitFor((): void => {
      expect(expansion.executions).toBeGreaterThanOrEqual(2);
      expect(reconcile.executions).toBeGreaterThanOrEqual(2);
      expect(recovery.executions).toBeGreaterThanOrEqual(2);
      expect(sender.inFlight).toBe(DISPATCH_CONCURRENCY);
    });
  });

  it.todo('WRK-02 실행 중인 워커 / 종료 신호를 받는다 → 새 claim을 즉시 멈추고 readiness를 내린다');
  it.todo(
    'WRK-03 진행 중인 요청이 있는 워커 / 종료 절차가 진행된다 → 진행 중 요청의 결과를 제한 시간 안에 저장한 뒤 DB 연결을 닫는다',
  );
  it.todo(
    'WRK-04 제한 시간 안에 끝나지 않는 요청 / 종료 절차가 진행된다 → 요청을 중단하고 lease를 남겨 둔 채 종료하며, 남은 건은 lease 만료 후 다른 워커가 reconcile한다',
  );

  it('부트스트랩 전에는 어떤 루프도 실행하지 않는다', async (): Promise<void> => {
    await setTimeout(POLL_INTERVAL_MS * 4);

    expect(executionCounts()).toEqual({ expansions: 0, sends: 0, reconciles: 0, recoveries: 0 });
  });

  it('모듈이 닫히면 진행 중인 발송이 끝난 뒤 모든 루프를 멈추고 더 실행하지 않는다', async (): Promise<void> => {
    await moduleRef.init();
    await vi.waitFor((): void => {
      expect(sender.inFlight).toBe(DISPATCH_CONCURRENCY);
    });

    const closing: Promise<void> = moduleRef.close();
    sender.release.open();
    await closing;
    const countsAtClose: ExecutionCounts = executionCounts();
    await setTimeout(POLL_INTERVAL_MS * 4);

    expect(sender.inFlight).toBe(0);
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
});
