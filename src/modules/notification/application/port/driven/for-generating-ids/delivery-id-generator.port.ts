import { DeliveryId } from '@/modules/notification/domain/delivery/delivery.type';

export abstract class DeliveryIdGeneratorPort {
  abstract deliveryId(): DeliveryId;
}
