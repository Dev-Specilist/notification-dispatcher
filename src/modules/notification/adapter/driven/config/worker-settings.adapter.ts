import { RetryPolicy } from '@/modules/notification/domain/delivery/retry-policy';
import { DispatchSettingsPort } from '@/modules/notification/application/port/driven/for-reading-settings/dispatch-settings.port';
import { ExpansionSettingsPort } from '@/modules/notification/application/port/driven/for-reading-settings/expansion-settings.port';
import { LeaseRecoverySettingsPort } from '@/modules/notification/application/port/driven/for-reading-settings/lease-recovery-settings.port';
import { ReconcileSettingsPort } from '@/modules/notification/application/port/driven/for-reading-settings/reconcile-settings.port';
import { DeliverySettingsValues } from '@/modules/notification/adapter/driven/config/worker-settings.type';
import { DurationMs } from '@/shared/domain/duration.type';

export class WorkerSettingsAdapter
  implements
    DispatchSettingsPort,
    LeaseRecoverySettingsPort,
    ReconcileSettingsPort,
    ExpansionSettingsPort
{
  readonly leaseMs: DurationMs;

  readonly maxRequestMs: DurationMs;

  readonly reconcileDelayMs: DurationMs;

  readonly retryPolicy: RetryPolicy;

  readonly lookupRetryPolicy: RetryPolicy;

  readonly unconfirmedAfterMs: DurationMs;

  constructor({
    leaseMs,
    maxRequestMs,
    reconcileDelayMs,
    retryPolicy,
    lookupRetryPolicy,
    unconfirmedAfterMs,
  }: Readonly<DeliverySettingsValues>) {
    this.leaseMs = leaseMs;
    this.maxRequestMs = maxRequestMs;
    this.reconcileDelayMs = reconcileDelayMs;
    this.retryPolicy = retryPolicy;
    this.lookupRetryPolicy = lookupRetryPolicy;
    this.unconfirmedAfterMs = unconfirmedAfterMs;
  }
}
