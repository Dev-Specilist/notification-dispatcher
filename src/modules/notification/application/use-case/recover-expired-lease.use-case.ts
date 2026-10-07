import { Injectable } from '@nestjs/common';
import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';
import {
  DeliverySnapshot,
  DeliveryTransition,
  LeaseToken,
} from '@/modules/notification/domain/delivery/delivery.type';
import { ClockPort } from '@/modules/notification/application/port/clock.port';
import {
  DeliveryCandidate,
  LeasedSave,
} from '@/modules/notification/application/port/delivery-repository.type';
import { LeaseRecoverySettingsPort } from '@/modules/notification/application/port/lease-recovery-settings.port';
import { UnitOfWorkPort } from '@/modules/notification/application/port/unit-of-work.port';
import { TransactionRepositories } from '@/modules/notification/application/port/unit-of-work.type';
import { RecoveryAttempt } from '@/modules/notification/application/use-case/recover-expired-lease.type';

@Injectable()
export class RecoverExpiredLeaseUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWorkPort,
    private readonly clock: ClockPort,
    private readonly settings: LeaseRecoverySettingsPort,
  ) {}

  execute(): Promise<RecoveryAttempt> {
    return this.unitOfWork.run(
      async ({ deliveryRepository }: TransactionRepositories): Promise<RecoveryAttempt> => {
        const now: Date = this.clock.now();
        const candidate: DeliveryCandidate = await deliveryRepository.findNextExpiredLease(now);
        if (candidate.kind === 'none') {
          return { kind: 'idle' };
        }
        const expired: Delivery = candidate.delivery;
        const { id }: DeliverySnapshot = expired.snapshot();
        const recovered: Delivery = RecoverExpiredLeaseUseCase.transitioned(
          expired.recoverExpiredLease(now, this.settings.reconcileDelayMs),
        );
        const saved: LeasedSave = await deliveryRepository.saveLeased(
          recovered,
          RecoverExpiredLeaseUseCase.leaseTokenOf(expired),
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
