import { AlarmId, RecipientId } from '@/modules/notification/domain/alarm/alarm.type';
import { DeliveryId, MessageId } from '@/modules/notification/domain/delivery/delivery.type';

export interface OutgoingMessage {
  readonly alarmId: AlarmId;
  readonly recipientId: RecipientId;
  readonly body: string;
  readonly clientRef: DeliveryId;
}

export interface SendAccepted {
  readonly kind: 'accepted';
  readonly messageId: MessageId;
}

export type SendOutcome = SendAccepted;
