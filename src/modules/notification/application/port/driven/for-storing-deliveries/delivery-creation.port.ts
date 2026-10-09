import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';

export abstract class DeliveryCreationPort {
  abstract saveAll(deliveries: ReadonlyArray<Delivery>): Promise<void>;

  abstract insertMissing(deliveries: ReadonlyArray<Delivery>): Promise<void>;
}
