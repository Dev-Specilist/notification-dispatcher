import { DurationMs } from '@/shared/domain/duration.type';

export class DurationPredicates {
  static readonly MAX_TIMER_DELAY_MS: number = 2_147_483_647;

  static isDurationMs(value: number): value is DurationMs {
    return Number.isSafeInteger(value) && value > 0;
  }
}
