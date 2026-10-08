import { AlarmId, DeliveryCount } from '@/modules/notification/domain/alarm/alarm.type';
import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';
import { LeaseToken } from '@/modules/notification/domain/delivery/delivery.type';
import {
  DeliveryCandidate,
  LeasedSave,
  ReconciledSave,
} from '@/modules/notification/application/port/out/delivery-repository.type';

export abstract class DeliveryRepositoryPort {
  abstract saveAll(deliveries: ReadonlyArray<Delivery>): Promise<void>;

  abstract insertMissing(deliveries: ReadonlyArray<Delivery>): Promise<void>;

  abstract findByAlarmId(alarmId: AlarmId): Promise<ReadonlyArray<Delivery>>;

  abstract findNextClaimable(now: Readonly<Date>): Promise<DeliveryCandidate>;

  abstract findNextExpiredLease(now: Readonly<Date>): Promise<DeliveryCandidate>;

  abstract findNextReconcilable(now: Readonly<Date>): Promise<DeliveryCandidate>;

  abstract saveReconciled(delivery: Delivery, previous: Delivery): Promise<ReconciledSave>;

  abstract saveLeased(delivery: Delivery, token: LeaseToken): Promise<LeasedSave>;

  abstract countUnsettled(alarmId: AlarmId): Promise<DeliveryCount>;

  abstract cancelWaiting(alarmId: AlarmId, now: Readonly<Date>): Promise<void>;
}
