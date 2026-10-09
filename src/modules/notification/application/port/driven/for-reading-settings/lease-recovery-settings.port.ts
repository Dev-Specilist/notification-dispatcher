import { DurationMs } from '@/shared/domain/duration.type';

export abstract class LeaseRecoverySettingsPort {
  abstract readonly reconcileDelayMs: DurationMs;
}
