import { Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { CompleteSettledAlarmsUseCase } from '@/modules/notification/application/port/in/complete-settled-alarms.use-case';
import { ExpandNextPageUseCase } from '@/modules/notification/application/port/in/expand-next-page.use-case';
import { ExpansionPageAttempt } from '@/modules/notification/application/port/in/expand-next-page.type';
import { ReconcileNextDeliveryUseCase } from '@/modules/notification/application/port/in/reconcile-next-delivery.use-case';
import { ReconcileAttempt } from '@/modules/notification/application/port/in/reconcile-next-delivery.type';
import { RecoverExpiredLeaseUseCase } from '@/modules/notification/application/port/in/recover-expired-lease.use-case';
import { RecoveryAttempt } from '@/modules/notification/application/port/in/recover-expired-lease.type';
import { SendNextDeliveryUseCase } from '@/modules/notification/application/port/in/send-next-delivery.use-case';
import { SendAttempt } from '@/modules/notification/application/port/in/send-next-delivery.type';
import { PollingLoopRunner } from '@/modules/notification/adapter/in/worker/polling-loop.runner';
import {
  PollingDelays,
  PollingOutcome,
} from '@/modules/notification/adapter/in/worker/polling-loop.type';
import { TypedConfigService } from '@/shared/config/typed-config.service';

@Injectable()
export class DispatchWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly loops: ReadonlyArray<PollingLoopRunner>;

  constructor(
    private readonly expandNextPage: ExpandNextPageUseCase,
    private readonly sendNextDelivery: SendNextDeliveryUseCase,
    private readonly reconcileNextDelivery: ReconcileNextDeliveryUseCase,
    private readonly recoverExpiredLease: RecoverExpiredLeaseUseCase,
    private readonly completeSettledAlarms: CompleteSettledAlarmsUseCase,
    config: TypedConfigService,
  ) {
    const delays: PollingDelays = {
      idleDelayMs: config.get('WORKER_POLL_INTERVAL_MS'),
      errorDelayMs: config.get('WORKER_ERROR_DELAY_MS'),
    };
    const completionCheckDelays: PollingDelays = {
      idleDelayMs: config.get('COMPLETION_CHECK_INTERVAL_MS'),
      errorDelayMs: config.get('WORKER_ERROR_DELAY_MS'),
    };
    const dispatchLoops: Array<PollingLoopRunner> = [];
    for (let slot: number = 1; slot <= config.get('DISPATCH_CONCURRENCY'); slot += 1) {
      dispatchLoops.push(
        new PollingLoopRunner(
          `dispatch-${slot}`,
          (): Promise<PollingOutcome> => this.send(),
          delays,
        ),
      );
    }
    this.loops = [
      new PollingLoopRunner('expansion', (): Promise<PollingOutcome> => this.expand(), delays),
      ...dispatchLoops,
      new PollingLoopRunner('reconcile', (): Promise<PollingOutcome> => this.reconcile(), delays),
      new PollingLoopRunner(
        'lease-recovery',
        (): Promise<PollingOutcome> => this.recoverLease(),
        delays,
      ),
      new PollingLoopRunner(
        'completion-check',
        (): Promise<PollingOutcome> => this.checkCompletion(),
        completionCheckDelays,
      ),
    ];
  }

  onApplicationBootstrap(): void {
    this.loops.forEach((loop: PollingLoopRunner): void => loop.start());
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.loops.map((loop: PollingLoopRunner): Promise<void> => loop.stop()));
  }

  private async expand(): Promise<PollingOutcome> {
    const { kind }: ExpansionPageAttempt = await this.expandNextPage.execute();
    return kind === 'idle' ? 'idle' : 'worked';
  }

  private async send(): Promise<PollingOutcome> {
    const { kind }: SendAttempt = await this.sendNextDelivery.execute();
    return kind === 'idle' || kind === 'no-permit' ? 'idle' : 'worked';
  }

  private async reconcile(): Promise<PollingOutcome> {
    const { kind }: ReconcileAttempt = await this.reconcileNextDelivery.execute();
    return kind === 'idle' ? 'idle' : 'worked';
  }

  private async recoverLease(): Promise<PollingOutcome> {
    const { kind }: RecoveryAttempt = await this.recoverExpiredLease.execute();
    return kind === 'idle' ? 'idle' : 'worked';
  }

  private async checkCompletion(): Promise<PollingOutcome> {
    await this.completeSettledAlarms.execute();
    return 'idle';
  }
}
