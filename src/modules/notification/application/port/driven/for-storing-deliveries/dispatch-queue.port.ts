import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';
import { LeaseToken } from '@/modules/notification/domain/delivery/delivery.type';
import {
  DeliveryCandidate,
  LeasedSave,
} from '@/modules/notification/application/port/driven/for-storing-deliveries/delivery-repository.type';

export abstract class DispatchQueuePort {
  abstract findNextClaimable(now: Readonly<Date>): Promise<DeliveryCandidate>;

  abstract saveAll(deliveries: ReadonlyArray<Delivery>): Promise<void>;

  abstract saveLeased(delivery: Delivery, token: LeaseToken): Promise<LeasedSave>;
}
