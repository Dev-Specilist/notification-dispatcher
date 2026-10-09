import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import {
  AlarmCompletionFailure,
  CompletionScanStart,
  SettledAlarmsPageChecked,
} from '@/modules/notification/application/port/driving/for-dispatching-alarms/complete-settled-alarms.type';
import { CompleteSettledAlarmsUseCase } from '@/modules/notification/application/port/driving/for-dispatching-alarms/complete-settled-alarms.use-case';
import { ExpandNextPageUseCase } from '@/modules/notification/application/port/driving/for-dispatching-alarms/expand-next-page.use-case';
import { ExpansionPageAttempt } from '@/modules/notification/application/port/driving/for-dispatching-alarms/expand-next-page.type';
import { ReconcileNextDeliveryUseCase } from '@/modules/notification/application/port/driving/for-dispatching-alarms/reconcile-next-delivery.use-case';
import { ReconcileAttempt } from '@/modules/notification/application/port/driving/for-dispatching-alarms/reconcile-next-delivery.type';
import { RecoverExpiredLeaseUseCase } from '@/modules/notification/application/port/driving/for-dispatching-alarms/recover-expired-lease.use-case';
import { RecoveryAttempt } from '@/modules/notification/application/port/driving/for-dispatching-alarms/recover-expired-lease.type';
import { SendNextDeliveryUseCase } from '@/modules/notification/application/port/driving/for-dispatching-alarms/send-next-delivery.use-case';
import { SendAttempt } from '@/modules/notification/application/port/driving/for-dispatching-alarms/send-next-delivery.type';
import { PollingLoopRunner } from '@/modules/notification/adapter/driving/worker/polling-loop.runner';
import {
  PollingDelays,
  PollingOutcome,
} from '@/modules/notification/adapter/driving/worker/polling-loop.type';
import { WorkerShutdownSignalAdapter } from '@/modules/notification/adapter/driven/process-state/worker-shutdown-signal.adapter';
import { TypedConfigService } from '@/shared/config/typed-config.service';

@Injectable()
export class DispatchWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private static readonly SHUTDOWN_TIMEOUT_SHARE_BEFORE_REQUEST_ABORT: number = 0.5;

  private readonly logger: Logger = new Logger('DispatchWorker');
  private readonly loops: ReadonlyArray<PollingLoopRunner>;
  private readonly requestAbortDelayMs: number;
  private completionStart: CompletionScanStart = { kind: 'newest' };

  constructor(
    private readonly expandNextPage: ExpandNextPageUseCase,
    private readonly sendNextDelivery: SendNextDeliveryUseCase,
    private readonly reconcileNextDelivery: ReconcileNextDeliveryUseCase,
    private readonly recoverExpiredLease: RecoverExpiredLeaseUseCase,
    private readonly completeSettledAlarms: CompleteSettledAlarmsUseCase,
    private readonly shutdownSignal: WorkerShutdownSignalAdapter,
    config: TypedConfigService,
  ) {
    this.requestAbortDelayMs = Math.floor(
      config.get('SHUTDOWN_TIMEOUT_MS') *
        DispatchWorker.SHUTDOWN_TIMEOUT_SHARE_BEFORE_REQUEST_ABORT,
    );
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
    this.shutdownSignal.request();
    const requestAbortTimer: NodeJS.Timeout = setTimeout((): void => {
      this.logger.warn(
        `in-flight work did not finish within ${this.requestAbortDelayMs}ms of shutdown, aborting outgoing requests`,
      );
      this.shutdownSignal.abortOutgoingRequests();
    }, this.requestAbortDelayMs);
    await Promise.all(this.loops.map((loop: PollingLoopRunner): Promise<void> => loop.stop()));
    clearTimeout(requestAbortTimer);
  }

  private async expand(): Promise<PollingOutcome> {
    const { kind }: ExpansionPageAttempt = await this.expandNextPage.execute();
    return kind === 'idle' ? 'idle' : 'worked';
  }

  private async send(): Promise<PollingOutcome> {
    const { kind }: SendAttempt = await this.sendNextDelivery.execute();
    return kind === 'idle' || kind === 'no-permit' || kind === 'stopped' ? 'idle' : 'worked';
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
    const { failures, next }: SettledAlarmsPageChecked = await this.completeSettledAlarms.execute({
      start: this.completionStart,
    });
    failures.forEach(({ alarmId, reason }: AlarmCompletionFailure): void => {
      this.logger.warn(`completion check failed for alarm ${alarmId}: ${reason}`);
    });
    if (next.kind === 'more') {
      this.completionStart = { kind: 'after', position: next.after };
      return 'worked';
    }
    this.completionStart = { kind: 'newest' };
    return 'idle';
  }
}
