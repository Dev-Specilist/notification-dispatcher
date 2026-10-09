import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';
import { DeliverySnapshot, LeaseToken } from '@/modules/notification/domain/delivery/delivery.type';
import { ClockPort } from '@/modules/notification/application/port/driven/for-telling-time/clock.port';
import {
  DeliveryCandidate,
  LeasedSave,
} from '@/modules/notification/application/port/driven/for-storing-deliveries/delivery-repository.type';
import { LeaseRecoverySettings } from '@/modules/notification/application/service/delivery/delivery-settings.type';
import { TransactionPort } from '@/modules/notification/application/port/driven/for-running-transactions/transaction.port';
import { RecoveryAttempt } from '@/modules/notification/application/port/driving/for-dispatching-alarms/recover-expired-lease.type';
import { RecoverExpiredLeaseUseCase } from '@/modules/notification/application/port/driving/for-dispatching-alarms/recover-expired-lease.use-case';
import { DeliveryRepositoryPort } from '@/modules/notification/application/port/driven/for-storing-deliveries/delivery-repository.port';
import { AcceptedTransition } from '@/modules/notification/application/service/accepted-transition.util';

interface RecoverExpiredLeaseRepositories {
  readonly deliveryRepository: Pick<DeliveryRepositoryPort, 'findNextExpiredLease' | 'saveLeased'>;
}

export class RecoverExpiredLeaseService implements RecoverExpiredLeaseUseCase {
  constructor(
    private readonly transaction: TransactionPort,
    private readonly clock: ClockPort,
    private readonly settings: Readonly<LeaseRecoverySettings>,
  ) {}

  execute(): Promise<RecoveryAttempt> {
    return this.transaction.run(
      async ({ deliveryRepository }: RecoverExpiredLeaseRepositories): Promise<RecoveryAttempt> => {
        const now: Date = this.clock.now();
        const candidate: DeliveryCandidate = await deliveryRepository.findNextExpiredLease(now);
        if (candidate.kind === 'none') {
          return { kind: 'idle' };
        }
        const expired: Delivery = candidate.delivery;
        const { id: deliveryId }: DeliverySnapshot = expired.snapshot();
        const recovered: Delivery = AcceptedTransition.delivery(
          expired.recoverExpiredLease(now, this.settings.reconcileDelayMs),
        );
        const saved: LeasedSave = await deliveryRepository.saveLeased(
          recovered,
          RecoverExpiredLeaseService.leaseTokenOf(expired),
        );
        return saved.kind === 'saved'
          ? { kind: 'recovered', deliveryId }
          : { kind: 'lease-lost', deliveryId };
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
}
