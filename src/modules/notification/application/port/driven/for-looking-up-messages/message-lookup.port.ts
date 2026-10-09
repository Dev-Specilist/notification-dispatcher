import { DeliveryId } from '@/modules/notification/domain/delivery/delivery.type';
import { MessageLookupResult } from '@/modules/notification/application/port/driven/for-looking-up-messages/message-lookup.type';

export abstract class MessageLookupPort {
  abstract findByClientRef(clientRef: DeliveryId): Promise<MessageLookupResult>;
}
