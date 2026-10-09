import { TimerDelayMs } from '@/shared/config/primitive.type';

export type PollingOutcome = 'worked' | 'idle';

export type PollingWork = () => Promise<PollingOutcome>;

export interface PollingDelays {
  readonly idleDelayMs: TimerDelayMs;
  readonly errorDelayMs: TimerDelayMs;
}
