import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';
import {
  DeliverySnapshot,
  DeliveryTransition,
  LeaseToken,
} from '@/modules/notification/domain/delivery/delivery.type';
import { ClockPort } from '@/modules/notification/application/port/out/clock.port';
import {
  DeliveryCandidate,
  LeasedSave,
} from '@/modules/notification/application/port/out/delivery-repository.type';
import { LeaseRecoverySettingsPort } from '@/modules/notification/application/port/out/lease-recovery-settings.port';
import { TransactionPort } from '@/modules/notification/application/port/out/transaction.port';
import { TransactionRepositories } from '@/modules/notification/application/port/out/transaction.type';
import { RecoveryAttempt } from '@/modules/notification/application/port/in/recover-expired-lease.type';
import { RecoverExpiredLeaseUseCase } from '@/modules/notification/application/port/in/recover-expired-lease.use-case';

export class RecoverExpiredLeaseService implements RecoverExpiredLeaseUseCase {
  constructor(
    private readonly transaction: TransactionPort,
    private readonly clock: ClockPort,
    private readonly settings: LeaseRecoverySettingsPort,
  ) {}

  execute(): Promise<RecoveryAttempt> {
    return this.transaction.run(
      async ({ leaseRecoveryQueue }: TransactionRepositories): Promise<RecoveryAttempt> => {
        const now: Date = this.clock.now();
        const candidate: DeliveryCandidate = await leaseRecoveryQueue.findNextExpiredLease(now);
        if (candidate.kind === 'none') {
          return { kind: 'idle' };
        }
        const expired: Delivery = candidate.delivery;
        const { id }: DeliverySnapshot = expired.snapshot();
        const recovered: Delivery = RecoverExpiredLeaseService.transitioned(
          expired.recoverExpiredLease(now, this.settings.reconcileDelayMs),
        );
        const saved: LeasedSave = await leaseRecoveryQueue.saveLeased(
          recovered,
          RecoverExpiredLeaseService.leaseTokenOf(expired),
        );
        return saved.kind === 'saved'
          ? { kind: 'recovered', deliveryId: id }
          : { kind: 'lease-lost', deliveryId: id };
      },
    );
  }

  private static leaseTokenOf(delivery: Delivery): LeaseToken {
    const { state }: DeliverySnapshot = delivery.snapshot();
    if (state.status !== 'IN_FLIGHT') {
      throw new Error(`delivery in ${state.status} has no lease to recover`);
    }
    return state.lease.token;
  }

  private static transitioned(transition: DeliveryTransition): Delivery {
    if (transition.kind === 'rejected') {
      throw new Error(`delivery transition was rejected: ${transition.reason}`);
    }
    return transition.delivery;
  }
}
