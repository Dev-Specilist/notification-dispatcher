import {
  CreateAlarmCommand,
  CreateAlarmResult,
} from '@/modules/notification/application/port/driving/for-managing-alarms/create-alarm.type';

export abstract class CreateAlarmUseCase {
  abstract execute(command: Readonly<CreateAlarmCommand>): Promise<CreateAlarmResult>;
}
