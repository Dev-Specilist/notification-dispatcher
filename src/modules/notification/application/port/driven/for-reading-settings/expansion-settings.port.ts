import { DurationMs } from '@/shared/domain/duration.type';

export abstract class ExpansionSettingsPort {
  abstract readonly leaseMs: DurationMs;
}
