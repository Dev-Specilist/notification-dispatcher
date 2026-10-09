import { SendAttempt } from '@/modules/notification/application/port/driving/for-dispatching-alarms/send-next-delivery.type';

export abstract class SendNextDeliveryUseCase {
  abstract execute(): Promise<SendAttempt>;
}
