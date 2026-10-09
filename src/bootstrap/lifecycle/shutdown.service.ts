import {
  BeforeApplicationShutdown,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  OnModuleDestroy,
} from '@nestjs/common';
import { Pool } from 'pg';
import { ReadinessPort } from '@/modules/health/application/port/driven/for-tracking-readiness/readiness.port';
import { TimerDelayOrZeroMs } from '@/shared/config/primitive.type';
import { TypedConfigService } from '@/shared/config/typed-config.service';

type SignalListener = (signal: NodeJS.Signals) => void;

@Injectable()
export class ShutdownService
  implements
    OnApplicationBootstrap,
    OnModuleDestroy,
    BeforeApplicationShutdown,
    OnApplicationShutdown
{
  static readonly SIGNALS: ReadonlyArray<NodeJS.Signals> = ['SIGTERM', 'SIGINT'];

  private readonly logger: Logger = new Logger('Shutdown');
  private readonly onSignal: SignalListener = (signal: NodeJS.Signals): void =>
    this.handleSignal(signal);
  private readonly watchdogs: Set<NodeJS.Timeout> = new Set<NodeJS.Timeout>();
  private watchdogStarted: boolean = false;

  constructor(
    private readonly readiness: ReadinessPort,
    private readonly config: TypedConfigService,
    private readonly pool: Pool,
  ) {}

  onApplicationBootstrap(): void {
    ShutdownService.SIGNALS.forEach((signal: NodeJS.Signals): void => {
      process.prependListener(signal, this.onSignal);
    });
  }

  handleSignal(signal: NodeJS.Signals): void {
    this.stopAcceptingTraffic(signal);
    this.startWatchdog();
  }

  onModuleDestroy(): void {
    this.stopAcceptingTraffic('close');
  }

  async beforeApplicationShutdown(signal: string = 'close'): Promise<void> {
    this.stopAcceptingTraffic(signal);
    const drainMs: TimerDelayOrZeroMs = this.config.get('SHUTDOWN_DRAIN_MS');
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, drainMs);
    });
  }

  async onApplicationShutdown(): Promise<void> {
    ShutdownService.SIGNALS.forEach((signal: NodeJS.Signals): void => {
      process.removeListener(signal, this.onSignal);
    });
    await this.closeDatabase();
    this.watchdogs.forEach((watchdog: NodeJS.Timeout): void => clearTimeout(watchdog));
    this.watchdogs.clear();
  }

  private async closeDatabase(): Promise<void> {
    if (this.pool.ending) {
      return;
    }
    await this.pool.end();
  }

  private stopAcceptingTraffic(reason: string): void {
    if (!this.readiness.isAcceptingTraffic()) {
      return;
    }
    this.readiness.stopAcceptingTraffic();
    this.logger.log(
      `${reason} received, readiness down, draining ${this.config.get('SHUTDOWN_DRAIN_MS')}ms`,
    );
  }

  private startWatchdog(): void {
    if (this.watchdogStarted) {
      return;
    }
    this.watchdogStarted = true;
    const deadlineMs: number =
      this.config.get('SHUTDOWN_DRAIN_MS') + this.config.get('SHUTDOWN_TIMEOUT_MS');
    const watchdog: NodeJS.Timeout = setTimeout((): void => {
      this.logger.error(`shutdown did not finish within ${deadlineMs}ms, forcing exit`);
      process.exit(1);
    }, deadlineMs);
    watchdog.unref();
    this.watchdogs.add(watchdog);
  }
}
