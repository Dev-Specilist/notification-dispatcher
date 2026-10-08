import { AlarmCommand } from '@/modules/notification/application/port/in/alarm-command.type';
import { ExpansionResult } from '@/modules/notification/application/port/in/expand-recipients.type';

export abstract class ExpandRecipientsUseCase {
  abstract execute(command: Readonly<AlarmCommand>): Promise<ExpansionResult>;
}
