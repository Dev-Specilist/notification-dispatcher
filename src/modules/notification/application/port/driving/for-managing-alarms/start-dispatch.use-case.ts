import {
  StartDispatchCommand,
  StartDispatchResult,
} from '@/modules/notification/application/port/driving/for-managing-alarms/start-dispatch.type';

export abstract class StartDispatchUseCase {
  abstract execute(command: Readonly<StartDispatchCommand>): Promise<StartDispatchResult>;
}
