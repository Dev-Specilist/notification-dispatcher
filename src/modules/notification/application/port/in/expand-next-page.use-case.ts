import { ExpansionPageAttempt } from '@/modules/notification/application/port/in/expand-next-page.type';

export abstract class ExpandNextPageUseCase {
  abstract execute(): Promise<ExpansionPageAttempt>;
}
