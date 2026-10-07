import {
  PageCursor,
  RecipientPage,
} from '@/modules/notification/application/port/recipient-directory.type';

export abstract class RecipientDirectoryPort {
  abstract fetchPage(cursor: PageCursor): Promise<RecipientPage>;
}
