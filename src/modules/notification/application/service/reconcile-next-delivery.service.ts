import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';
import {
  DeliverySnapshot,
  DeliveryTransition,
} from '@/modules/notification/domain/delivery/delivery.type';
import {
  AlarmFound,
  AlarmLookup,
} from '@/modules/notification/application/port/out/alarm-repository.type';
import { ClockPort } from '@/modules/notification/application/port/out/clock.port';
import {
  CandidateFound,
  DeliveryCandidate,
  ReconciledSave,
} from '@/modules/notification/application/port/out/delivery-repository.type';
import { JitterSourcePort } from '@/modules/notification/application/port/out/jitter-source.port';
import { MessageLookupPort } from '@/modules/notification/application/port/out/message-lookup.port';
import { MessageLookupResult } from '@/modules/notification/application/port/out/message-lookup.type';
import { ReconcileSettingsPort } from '@/modules/notification/application/port/out/reconcile-settings.port';
import { TransactionPort } from '@/modules/notification/application/port/out/transaction.port';
import { TransactionRepositories } from '@/modules/notification/application/port/out/transaction.type';
import { ReconcileAttempt } from '@/modules/notification/application/port/in/reconcile-next-delivery.type';
import { ReconcileNextDeliveryUseCase } from '@/modules/notification/application/port/in/reconcile-next-delivery.use-case';

export class ReconcileNextDeliveryService implements ReconcileNextDeliveryUseCase {
  constructor(
    private readonly transaction: TransactionPort,
    private readonly messageLookup: MessageLookupPort,
    private readonly clock: ClockPort,
    private readonly settings: ReconcileSettingsPort,
    private readonly jitterSource: JitterSourcePort,
  ) {}

  async execute(): Promise<ReconcileAttempt> {
    const candidate: DeliveryCandidate = await this.transaction.run(
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
    return this.transaction.run(
      async ({
        alarmRepository,
        deliveryRepository,
      }: TransactionRepositories): Promise<ReconcileAttempt> => {
        const alarm: AlarmLookup = await alarmRepository.findById(alarmId);
        const reconciled: Delivery = ReconcileNextDeliveryService.transitioned(
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
        return ReconcileNextDeliveryService.isActive(alarm)
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
