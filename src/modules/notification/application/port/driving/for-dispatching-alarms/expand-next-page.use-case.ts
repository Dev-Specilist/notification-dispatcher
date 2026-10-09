import { ExpansionPageAttempt } from '@/modules/notification/application/port/driving/for-dispatching-alarms/expand-next-page.type';

export abstract class ExpandNextPageUseCase {
  abstract execute(): Promise<ExpansionPageAttempt>;
}
