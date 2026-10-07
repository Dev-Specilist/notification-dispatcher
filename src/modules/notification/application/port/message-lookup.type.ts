import { FoundMessages } from '@/modules/notification/domain/delivery/delivery.type';

export interface MessagesFound {
  readonly kind: 'found';
  readonly messages: FoundMessages;
}

export interface NoMessages {
  readonly kind: 'none';
}

export interface LookupFailed {
  readonly kind: 'lookup-failed';
}

export type MessageLookupResult = MessagesFound | NoMessages | LookupFailed;
