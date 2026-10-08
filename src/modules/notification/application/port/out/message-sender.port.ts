import {
  OutgoingMessage,
  SendOutcome,
} from '@/modules/notification/application/port/out/message-sender.type';

export abstract class MessageSenderPort {
  abstract send(message: OutgoingMessage): Promise<SendOutcome>;
}
