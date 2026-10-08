import { SendAttempt } from '@/modules/notification/application/port/in/send-next-delivery.type';

export abstract class SendNextDeliveryUseCase {
  abstract execute(): Promise<SendAttempt>;
}
