import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import { DeliveryStatusCounts } from '@/modules/notification/domain/delivery/delivery.type';
import { AlarmLookup } from '@/modules/notification/application/port/out/alarm-repository.type';
import { TransactionPort } from '@/modules/notification/application/port/out/transaction.port';
import { SnapshotRepositories } from '@/modules/notification/application/port/out/transaction.type';
import { AlarmResult } from '@/modules/notification/application/port/driving/for-managing-alarms/alarm-result.type';
import { GetAlarmQuery } from '@/modules/notification/application/port/driving/for-managing-alarms/get-alarm.type';
import { GetAlarmUseCase } from '@/modules/notification/application/port/driving/for-managing-alarms/get-alarm.use-case';
import { AlarmViewMapper } from '@/modules/notification/application/service/alarm/view/alarm-view.mapper';
import { DeliveryProgressViewMapper } from '@/modules/notification/application/service/alarm/view/delivery-progress-view.mapper';

export class GetAlarmService implements GetAlarmUseCase {
  constructor(private readonly transaction: TransactionPort) {}

  async execute({ alarmId }: Readonly<GetAlarmQuery>): Promise<AlarmResult> {
    if (!AlarmPredicates.isAlarmId(alarmId)) {
      return { kind: 'not-found', error: { code: 'ALARM_NOT_FOUND', alarmId } };
    }
    return this.transaction.readSnapshot(
      (repositories: SnapshotRepositories): Promise<AlarmResult> =>
        GetAlarmService.readAlarmWithProgress(repositories, alarmId),
    );
  }

  private static async readAlarmWithProgress(
    { alarmReader, deliveryProgress }: SnapshotRepositories,
    alarmId: AlarmId,
  ): Promise<AlarmResult> {
    const lookup: AlarmLookup = await alarmReader.findById(alarmId);
    if (lookup.kind === 'missing') {
      return { kind: 'not-found', error: { code: 'ALARM_NOT_FOUND', alarmId } };
    }
    const deliveryStatusCounts: DeliveryStatusCounts =
      await deliveryProgress.countByStatus(alarmId);
    return {
      kind: 'found',
      alarm: AlarmViewMapper.toView(lookup.alarm),
      deliveries: DeliveryProgressViewMapper.toView(deliveryStatusCounts),
    };
  }
}
