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
import { ReconcileSettings } from '@/modules/notification/application/service/delivery/delivery-settings.type';
import { TransactionPort } from '@/modules/notification/application/port/driven/for-running-transactions/transaction.port';
import {
  NothingToReconcile,
  ReconcileAttempt,
  ReconcileSuperseded,
} from '@/modules/notification/application/port/driving/for-dispatching-alarms/reconcile-next-delivery.type';
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

interface ReconcileReserved {
  readonly kind: 'reserved';
  readonly candidate: Delivery;
  readonly reserved: Delivery;
}

type ReconcileReservation = ReconcileReserved | NothingToReconcile | ReconcileSuperseded;

export class ReconcileNextDeliveryService implements ReconcileNextDeliveryUseCase {
  constructor(
    private readonly transaction: TransactionPort,
    private readonly messageLookup: MessageLookupPort,
    private readonly clock: ClockPort,
    private readonly settings: Readonly<ReconcileSettings>,
    private readonly jitterSource: JitterSourcePort,
  ) {}

  async execute(): Promise<ReconcileAttempt> {
    const reservation: ReconcileReservation = await this.reserveNext();
    if (reservation.kind !== 'reserved') {
      return reservation;
    }
    const { candidate, reserved }: ReconcileReserved = reservation;
    const { id: deliveryId }: DeliverySnapshot = candidate.snapshot();
    const lookup: MessageLookupResult = await this.messageLookup.findByClientRef(deliveryId);
    return this.record(candidate, reserved, lookup);
  }

  private reserveNext(): Promise<ReconcileReservation> {
    return this.transaction.run(
      async ({
        deliveryRepository,
      }: ReconcileNextDeliveryRepositories): Promise<ReconcileReservation> => {
        const now: Date = this.clock.now();
        const nextReconcilable: DeliveryCandidate =
          await deliveryRepository.findNextReconcilable(now);
        if (nextReconcilable.kind === 'none') {
          return { kind: 'idle' };
        }
        const { delivery: candidate }: CandidateFound = nextReconcilable;
        const reserved: Delivery = ReconcileNextDeliveryService.transitioned(
          candidate.reserveReconcile(now, this.settings.leaseMs),
        );
        const saved: ReconciledSave = await deliveryRepository.saveReconciled(reserved, candidate);
        return saved.kind === 'saved'
          ? { kind: 'reserved', candidate, reserved }
          : { kind: 'superseded', deliveryId: candidate.snapshot().id };
      },
    );
  }

  private record(
    candidate: Delivery,
    reserved: Delivery,
    lookup: MessageLookupResult,
  ): Promise<ReconcileAttempt> {
    const { id, alarmId }: DeliverySnapshot = candidate.snapshot();
    return this.transaction.run(
      async ({
        alarmRepository,
        deliveryRepository,
      }: ReconcileNextDeliveryRepositories): Promise<ReconcileAttempt> => {
        const alarm: AlarmLookup = await alarmRepository.findById(alarmId);
        const reconciled: Delivery = ReconcileNextDeliveryService.transitioned(
          this.decide(candidate, lookup, alarm, this.clock.now()),
        );
        const saved: ReconciledSave = await deliveryRepository.saveReconciled(reconciled, reserved);
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
