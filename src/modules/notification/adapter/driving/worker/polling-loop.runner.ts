import { Logger } from '@nestjs/common';
import {
  PollingDelays,
  PollingOutcome,
  PollingWork,
} from '@/modules/notification/adapter/driving/worker/polling-loop.type';
import { ThrownValues } from '@/shared/error/thrown-value.util';

export class PollingLoopRunner {
  private readonly logger: Logger = new Logger('PollingLoop');
  private readonly stopRequest: AbortController = new AbortController();
  private running: Promise<void> = Promise.resolve();
  private started: boolean = false;

  constructor(
    private readonly name: string,
    private readonly work: PollingWork,
    private readonly delays: Readonly<PollingDelays>,
  ) {}

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.running = this.loop();
  }

  async stop(): Promise<void> {
    this.stopRequest.abort();
    await this.running;
  }

  private async loop(): Promise<void> {
    while (!this.stopRequest.signal.aborted) {
      const delayMs: number = await this.pass();
      await this.pause(delayMs);
    }
  }

  private async pass(): Promise<number> {
    try {
      const outcome: PollingOutcome = await this.work();
      return outcome === 'idle' ? this.delays.idleDelayMs : 0;
    } catch (error) {
      const { message, stack }: Error = ThrownValues.toError(error);
      this.logger.error(`${this.name} pass failed: ${message}`, stack);
      return this.delays.errorDelayMs;
    }
  }

  private pause(delayMs: number): Promise<void> {
    const { signal }: AbortController = this.stopRequest;
    return new Promise<void>((resolve: () => void): void => {
      if (delayMs === 0 || signal.aborted) {
        setImmediate(resolve);
        return;
      }
      const timer: NodeJS.Timeout = setTimeout((): void => {
        signal.removeEventListener('abort', onStop);
        resolve();
      }, delayMs);
      const onStop: () => void = (): void => {
        clearTimeout(timer);
        resolve();
      };
      signal.addEventListener('abort', onStop, { once: true });
    });
  }
}
