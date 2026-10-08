import { AlarmCreation, AlarmDraft } from '@/modules/notification/domain/alarm/alarm.type';

export abstract class CreateAlarmUseCase {
  abstract execute(draft: Readonly<AlarmDraft>): Promise<AlarmCreation>;
}
