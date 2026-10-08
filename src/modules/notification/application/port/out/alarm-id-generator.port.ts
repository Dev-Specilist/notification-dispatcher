import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';

export abstract class AlarmIdGeneratorPort {
  abstract alarmId(): AlarmId;
}
