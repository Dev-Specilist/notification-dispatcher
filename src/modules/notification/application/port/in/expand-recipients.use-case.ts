import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import { ExpansionResult } from '@/modules/notification/application/port/in/expand-recipients.type';

export abstract class ExpandRecipientsUseCase {
  abstract execute(alarmId: AlarmId): Promise<ExpansionResult>;
}
