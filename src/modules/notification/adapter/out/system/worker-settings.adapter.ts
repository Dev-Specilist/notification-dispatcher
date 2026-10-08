import { RetryPolicy } from '@/modules/notification/domain/delivery/retry-policy';
import { DispatchSettingsPort } from '@/modules/notification/application/port/out/dispatch-settings.port';
import { ExpansionSettingsPort } from '@/modules/notification/application/port/out/expansion-settings.port';
import { LeaseRecoverySettingsPort } from '@/modules/notification/application/port/out/lease-recovery-settings.port';
import { ReconcileSettingsPort } from '@/modules/notification/application/port/out/reconcile-settings.port';
import { DeliverySettingsValues } from '@/modules/notification/adapter/out/system/worker-settings.type';
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
