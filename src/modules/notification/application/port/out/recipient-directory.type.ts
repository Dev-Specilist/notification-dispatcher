import { RecipientId } from '@/modules/notification/domain/alarm/alarm.type';

export interface FirstPage {
  readonly kind: 'first';
}

export interface NextPage {
  readonly kind: 'next';
  readonly token: string;
}

export type PageCursor = FirstPage | NextPage;

export interface EndOfPages {
  readonly kind: 'end';
}

export type FollowingPage = NextPage | EndOfPages;

export interface RecipientPage {
  readonly recipientIds: ReadonlyArray<RecipientId>;
  readonly next: FollowingPage;
}
