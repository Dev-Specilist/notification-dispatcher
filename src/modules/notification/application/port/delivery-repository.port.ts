import { AlarmId, DeliveryCount } from '@/modules/notification/domain/alarm/alarm.type';
import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';
import { LeaseToken } from '@/modules/notification/domain/delivery/delivery.type';
import {
  ClaimableLookup,
  LeasedSave,
} from '@/modules/notification/application/port/delivery-repository.type';

export abstract class DeliveryRepositoryPort {
  abstract saveAll(deliveries: ReadonlyArray<Delivery>): Promise<void>;

  abstract insertMissing(deliveries: ReadonlyArray<Delivery>): Promise<void>;

  abstract findByAlarmId(alarmId: AlarmId): Promise<ReadonlyArray<Delivery>>;

  abstract findNextClaimable(now: Readonly<Date>): Promise<ClaimableLookup>;

  abstract saveLeased(delivery: Delivery, token: LeaseToken): Promise<LeasedSave>;

  abstract countUnsettled(alarmId: AlarmId): Promise<DeliveryCount>;

  abstract cancelWaiting(alarmId: AlarmId, now: Readonly<Date>): Promise<void>;
}
