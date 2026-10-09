import { AlarmId, DeliveryCount } from '@/modules/notification/domain/alarm/alarm.type';
import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';
import {
  DeliveryStatusCounts,
  LeaseToken,
} from '@/modules/notification/domain/delivery/delivery.type';
import {
  DeliveryCandidate,
  LeasedSave,
  ReconciledSave,
} from '@/modules/notification/application/port/driven/for-storing-deliveries/delivery-repository.type';

export abstract class DeliveryRepositoryPort {
  abstract saveAll(deliveries: ReadonlyArray<Delivery>): Promise<void>;

  abstract insertMissing(deliveries: ReadonlyArray<Delivery>): Promise<void>;

  abstract findNextClaimable(now: Readonly<Date>): Promise<DeliveryCandidate>;

  abstract findNextExpiredLease(now: Readonly<Date>): Promise<DeliveryCandidate>;

  abstract findNextReconcilable(now: Readonly<Date>): Promise<DeliveryCandidate>;

  abstract saveLeased(delivery: Delivery, token: LeaseToken): Promise<LeasedSave>;

  abstract saveReconciled(delivery: Delivery, previous: Delivery): Promise<ReconciledSave>;

  abstract cancelWaiting(alarmId: AlarmId, now: Readonly<Date>): Promise<void>;

  abstract countUnsettled(alarmId: AlarmId): Promise<DeliveryCount>;

  abstract countByStatus(alarmId: AlarmId): Promise<DeliveryStatusCounts>;
}
