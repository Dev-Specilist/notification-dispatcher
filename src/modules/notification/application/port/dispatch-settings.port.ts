import { DurationMs } from '@/shared/domain/duration.type';

export abstract class DispatchSettingsPort {
  abstract readonly leaseMs: DurationMs;

  abstract readonly maxRequestMs: DurationMs;
}
