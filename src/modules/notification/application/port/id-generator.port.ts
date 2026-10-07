import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';

export abstract class IdGeneratorPort {
  abstract alarmId(): AlarmId;
}
