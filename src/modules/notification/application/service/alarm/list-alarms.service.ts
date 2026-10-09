import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import { AlarmRepositoryPredicates } from '@/modules/notification/application/port/driven/for-storing-alarms/alarm-repository.predicate';
import {
  AlarmPage,
  AlarmPageNext,
  AlarmPageStart,
  AlarmPosition,
} from '@/modules/notification/application/port/driven/for-storing-alarms/alarm-repository.type';
import { TransactionPort } from '@/modules/notification/application/port/driven/for-running-transactions/transaction.port';
import { SnapshotRepositories } from '@/modules/notification/application/port/driven/for-running-transactions/transaction.type';
import { AlarmView } from '@/modules/notification/application/port/driving/for-managing-alarms/alarm-view.type';
import {
  ListAlarmsQuery,
  ListAlarmsResult,
  ListNext,
  ListPosition,
  ListStart,
} from '@/modules/notification/application/port/driving/for-managing-alarms/list-alarms.type';
import { ListAlarmsUseCase } from '@/modules/notification/application/port/driving/for-managing-alarms/list-alarms.use-case';
import { AlarmViewMapper } from '@/modules/notification/application/service/alarm/view/alarm-view.mapper';

interface ValidPageStart {
  readonly kind: 'valid';
  readonly start: AlarmPageStart;
}

interface InvalidPageStart {
  readonly kind: 'invalid';
}

type PageStartCheck = ValidPageStart | InvalidPageStart;

export class ListAlarmsService implements ListAlarmsUseCase {
  constructor(private readonly transaction: TransactionPort) {}

  async execute({
    status,
    alarmKind,
    start,
    limit,
  }: Readonly<ListAlarmsQuery>): Promise<ListAlarmsResult> {
    if (!AlarmRepositoryPredicates.isPageSize(limit)) {
      return { kind: 'rejected', error: { code: 'INVALID_LIMIT', limit } };
    }
    const pageStartCheck: PageStartCheck = ListAlarmsService.toPageStart(start);
    if (pageStartCheck.kind === 'invalid') {
      return { kind: 'rejected', error: { code: 'INVALID_CURSOR' } };
    }
    const alarmPage: AlarmPage = await this.transaction.readSnapshot(
      ({ alarmReader }: SnapshotRepositories): Promise<AlarmPage> =>
        alarmReader.findPage({ status, alarmKind, start: pageStartCheck.start, size: limit }),
    );
    return {
      kind: 'page',
      items: alarmPage.alarms.map((alarm: Alarm): AlarmView => AlarmViewMapper.toView(alarm)),
      next: ListAlarmsService.toListNext(alarmPage.next),
    };
  }

  private static toPageStart(start: ListStart): PageStartCheck {
    if (start.kind === 'newest') {
      return { kind: 'valid', start };
    }
    const { createdAt, alarmId }: ListPosition = start.position;
    if (!AlarmPredicates.isAlarmId(alarmId) || !Number.isFinite(createdAt.getTime())) {
      return { kind: 'invalid' };
    }
    return { kind: 'valid', start: { kind: 'after', position: { createdAt, id: alarmId } } };
  }

  private static toListNext(next: AlarmPageNext): ListNext {
    if (next.kind === 'last') {
      return next;
    }
    const { createdAt, id: alarmId }: AlarmPosition = next.after;
    return { kind: 'more', after: { createdAt, alarmId } };
  }
}
