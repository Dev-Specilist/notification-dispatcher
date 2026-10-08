import {
  CreateAlarmCommand,
  CreateAlarmResult,
} from '@/modules/notification/application/port/in/create-alarm.type';

export abstract class CreateAlarmUseCase {
  abstract execute(command: Readonly<CreateAlarmCommand>): Promise<CreateAlarmResult>;
}
