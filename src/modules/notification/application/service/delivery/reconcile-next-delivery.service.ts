import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';
import {
  DeliverySnapshot,
  DeliveryTransition,
} from '@/modules/notification/domain/delivery/delivery.type';
import {
  AlarmFound,
  AlarmLookup,
} from '@/modules/notification/application/port/driven/for-storing-alarms/alarm-repository.type';
import { ClockPort } from '@/modules/notification/application/port/driven/for-telling-time/clock.port';
import {
  CandidateFound,
  DeliveryCandidate,
  ReconciledSave,
} from '@/modules/notification/application/port/driven/for-storing-deliveries/delivery-repository.type';
import { JitterSourcePort } from '@/modules/notification/application/port/driven/for-drawing-jitter/jitter-source.port';
import { MessageLookupPort } from '@/modules/notification/application/port/driven/for-looking-up-messages/message-lookup.port';
import { MessageLookupResult } from '@/modules/notification/application/port/driven/for-looking-up-messages/message-lookup.type';
import { ReconcileSettingsPort } from '@/modules/notification/application/port/driven/for-reading-settings/reconcile-settings.port';
import { TransactionPort } from '@/modules/notification/application/port/driven/for-running-transactions/transaction.port';
import { ReconcileAttempt } from '@/modules/notification/application/port/driving/for-dispatching-alarms/reconcile-next-delivery.type';
import { ReconcileNextDeliveryUseCase } from '@/modules/notification/application/port/driving/for-dispatching-alarms/reconcile-next-delivery.use-case';
import { DeliveryRepositoryPort } from '@/modules/notification/application/port/driven/for-storing-deliveries/delivery-repository.port';
import { AlarmRepositoryPort } from '@/modules/notification/application/port/driven/for-storing-alarms/alarm-repository.port';

interface ReconcileNextDeliveryRepositories {
  readonly alarmRepository: Pick<AlarmRepositoryPort, 'findById'>;
  readonly deliveryRepository: Pick<
    DeliveryRepositoryPort,
    'findNextReconcilable' | 'saveReconciled'
  >;
}

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
      ({ deliveryRepository }: ReconcileNextDeliveryRepositories): Promise<DeliveryCandidate> =>
        deliveryRepository.findNextReconcilable(this.clock.now()),
    );
    if (candidate.kind === 'none') {
      return { kind: 'idle' };
    }
    const { delivery }: CandidateFound = candidate;
    const { id: deliveryId }: DeliverySnapshot = delivery.snapshot();
    const lookup: MessageLookupResult = await this.messageLookup.findByClientRef(deliveryId);
    return this.record(delivery, lookup);
  }

  private record(delivery: Delivery, lookup: MessageLookupResult): Promise<ReconcileAttempt> {
    const { id, alarmId }: DeliverySnapshot = delivery.snapshot();
    return this.transaction.run(
      async ({
        alarmRepository,
        deliveryRepository,
      }: ReconcileNextDeliveryRepositories): Promise<ReconcileAttempt> => {
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
