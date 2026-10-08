import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';
import {
  DeliverySnapshot,
  DeliveryTransition,
} from '@/modules/notification/domain/delivery/delivery.type';
import {
  AlarmFound,
  AlarmLookup,
} from '@/modules/notification/application/port/alarm-repository.type';
import { ClockPort } from '@/modules/notification/application/port/clock.port';
import {
  CandidateFound,
  DeliveryCandidate,
  ReconciledSave,
} from '@/modules/notification/application/port/delivery-repository.type';
import { JitterSourcePort } from '@/modules/notification/application/port/jitter-source.port';
import { MessageLookupPort } from '@/modules/notification/application/port/message-lookup.port';
import { MessageLookupResult } from '@/modules/notification/application/port/message-lookup.type';
import { ReconcileSettingsPort } from '@/modules/notification/application/port/reconcile-settings.port';
import { UnitOfWorkPort } from '@/modules/notification/application/port/unit-of-work.port';
import { TransactionRepositories } from '@/modules/notification/application/port/unit-of-work.type';
import { ReconcileAttempt } from '@/modules/notification/application/use-case/reconcile-next-delivery.type';

export class ReconcileNextDeliveryUseCase {
  constructor(
    private readonly unitOfWork: UnitOfWorkPort,
    private readonly messageLookup: MessageLookupPort,
    private readonly clock: ClockPort,
    private readonly settings: ReconcileSettingsPort,
    private readonly jitterSource: JitterSourcePort,
  ) {}

  async execute(): Promise<ReconcileAttempt> {
    const candidate: DeliveryCandidate = await this.unitOfWork.run(
      ({ deliveryRepository }: TransactionRepositories): Promise<DeliveryCandidate> =>
        deliveryRepository.findNextReconcilable(this.clock.now()),
    );
    if (candidate.kind === 'none') {
      return { kind: 'idle' };
    }
    const { delivery }: CandidateFound = candidate;
    const { id }: DeliverySnapshot = delivery.snapshot();
    const lookup: MessageLookupResult = await this.messageLookup.findByClientRef(id);
    return this.record(delivery, lookup);
  }

  private record(delivery: Delivery, lookup: MessageLookupResult): Promise<ReconcileAttempt> {
    const { id, alarmId }: DeliverySnapshot = delivery.snapshot();
    return this.unitOfWork.run(
      async ({
        alarmRepository,
        deliveryRepository,
      }: TransactionRepositories): Promise<ReconcileAttempt> => {
        const alarm: AlarmLookup = await alarmRepository.findById(alarmId);
        const reconciled: Delivery = ReconcileNextDeliveryUseCase.transitioned(
          this.decide(delivery, lookup, alarm, this.clock.now()),
        );
        const saved: ReconciledSave = await deliveryRepository.saveReconciled(reconciled, delivery);
        return saved.kind === 'saved'
          ? { kind: 'reconciled', deliveryId: id, status: reconciled.snapshot().state.status }
          : { kind: 'superseded', deliveryId: id };
      },
    );
  }

  private decide(
    delivery: Delivery,
    lookup: MessageLookupResult,
    alarm: AlarmLookup,
    now: Readonly<Date>,
  ): DeliveryTransition {
    switch (lookup.kind) {
      case 'found':
        return delivery.reconcileFound(lookup.messages);
      case 'none':
        return ReconcileNextDeliveryUseCase.isActive(alarm)
          ? delivery.reconcileNotFound(now, this.settings.retryPolicy, this.jitterSource.next())
          : delivery.reconcileNotFoundAsCancelled(now);
      case 'lookup-failed':
        break;
    }
    const expired: DeliveryTransition = delivery.expireUnconfirmed(
      now,
      this.settings.unconfirmedAfterMs,
    );
    return expired.kind === 'transitioned'
      ? expired
      : delivery.recordLookupFailure(
          now,
          this.settings.lookupRetryPolicy,
          this.jitterSource.next(),
        );
  }

  private static isActive(alarm: AlarmLookup): alarm is AlarmFound {
    return alarm.kind === 'found' && alarm.alarm.snapshot().state.status !== 'CANCELLED';
  }

  private static transitioned(transition: DeliveryTransition): Delivery {
    if (transition.kind === 'rejected') {
      throw new Error(`delivery transition was rejected: ${transition.reason}`);
    }
    return transition.delivery;
  }
}
