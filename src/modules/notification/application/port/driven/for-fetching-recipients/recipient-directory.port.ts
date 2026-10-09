import {
  PageCursor,
  RecipientPage,
} from '@/modules/notification/application/port/driven/for-fetching-recipients/recipient-directory.type';

export abstract class RecipientDirectoryPort {
  abstract fetchPage(cursor: PageCursor): Promise<RecipientPage>;
}
