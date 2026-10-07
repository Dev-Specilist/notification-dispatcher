import { DurationMs } from '@/shared/domain/duration.type';

export class DurationPredicates {
  static isDurationMs(value: number): value is DurationMs {
    return Number.isSafeInteger(value) && value > 0;
  }
}
