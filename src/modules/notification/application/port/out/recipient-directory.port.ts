import {
  PageCursor,
  RecipientPage,
} from '@/modules/notification/application/port/out/recipient-directory.type';

export abstract class RecipientDirectoryPort {
  abstract fetchPage(cursor: PageCursor): Promise<RecipientPage>;
}
