import { DeliveryId } from '@/modules/notification/domain/delivery/delivery.type';
import { MessageLookupResult } from '@/modules/notification/application/port/message-lookup.type';

export abstract class MessageLookupPort {
  abstract findByClientRef(clientRef: DeliveryId): Promise<MessageLookupResult>;
}
