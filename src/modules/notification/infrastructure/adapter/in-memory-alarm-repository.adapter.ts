import { Injectable } from '@nestjs/common';
import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import { AlarmId, AlarmSnapshot } from '@/modules/notification/domain/alarm/alarm.type';
import { AlarmRepositoryPort } from '@/modules/notification/application/port/alarm-repository.port';
import {
  AlarmFound,
  AlarmLookup,
  AlarmPage,
  AlarmPageQuery,
  AlarmPageStart,
  AlarmPosition,
  ValueFilter,
} from '@/modules/notification/application/port/alarm-repository.type';
import { Rollback } from '@/modules/notification/infrastructure/adapter/rollback.type';

@Injectable()
export class InMemoryAlarmRepositoryAdapter implements AlarmRepositoryPort {
  private readonly alarmsById: Map<AlarmId, AlarmFound> = new Map<AlarmId, AlarmFound>();

  save(alarm: Alarm): Promise<void> {
    this.alarmsById.set(alarm.snapshot().id, { kind: 'found', alarm });
    return Promise.resolve();
  }

  findById(id: AlarmId): Promise<AlarmLookup> {
    return Promise.resolve(this.alarmsById.get(id) ?? { kind: 'missing' });
  }

  findByIdForUpdate(id: AlarmId): Promise<AlarmLookup> {
    return this.findById(id);
  }

  findPage({ status, alarmKind, start, size }: Readonly<AlarmPageQuery>): Promise<AlarmPage> {
    const matching: ReadonlyArray<Alarm> = [...this.alarmsById.values()]
      .map(({ alarm }: AlarmFound): Alarm => alarm)
      .filter((alarm: Alarm): boolean => {
        const { state, kind }: AlarmSnapshot = alarm.snapshot();
        return (
          InMemoryAlarmRepositoryAdapter.matches(status, state.status) &&
          InMemoryAlarmRepositoryAdapter.matches(alarmKind, kind) &&
          InMemoryAlarmRepositoryAdapter.isAfterStart(start, alarm)
        );
      })
      .toSorted((left: Alarm, right: Alarm): number =>
        InMemoryAlarmRepositoryAdapter.compareNewestFirst(
          InMemoryAlarmRepositoryAdapter.positionOf(left),
          InMemoryAlarmRepositoryAdapter.positionOf(right),
        ),
      );
    const page: ReadonlyArray<Alarm> = matching.slice(0, size);
    const [last]: ReadonlyArray<Alarm> = page.slice(-1);
    return Promise.resolve({
      alarms: page,
      next:
        matching.length > size
          ? { kind: 'more', after: InMemoryAlarmRepositoryAdapter.positionOf(last) }
          : { kind: 'last' },
    });
  }

  private static matches<TValue>(filter: ValueFilter<TValue>, value: TValue): boolean {
    return filter.kind === 'any' || filter.value === value;
  }

  private static isAfterStart(start: AlarmPageStart, alarm: Alarm): boolean {
    return (
      start.kind === 'newest' ||
      InMemoryAlarmRepositoryAdapter.compareNewestFirst(
        start.position,
        InMemoryAlarmRepositoryAdapter.positionOf(alarm),
      ) < 0
    );
  }

  private static positionOf(alarm: Alarm): AlarmPosition {
    const { createdAt, id }: AlarmSnapshot = alarm.snapshot();
    return { createdAt, id };
  }

  private static compareNewestFirst(
    left: Readonly<AlarmPosition>,
    right: Readonly<AlarmPosition>,
  ): number {
    const byCreatedAt: number = right.createdAt.getTime() - left.createdAt.getTime();
    if (byCreatedAt !== 0) {
      return byCreatedAt;
    }
    const leftId: string = left.id.toLowerCase();
    const rightId: string = right.id.toLowerCase();
    if (leftId === rightId) {
      return 0;
    }
    return leftId < rightId ? 1 : -1;
  }

  checkpoint(): Rollback {
    const saved: Map<AlarmId, AlarmFound> = new Map<AlarmId, AlarmFound>(this.alarmsById);
    return (): void => {
      this.alarmsById.clear();
      saved.forEach((value: AlarmFound, key: AlarmId): void => {
        this.alarmsById.set(key, value);
      });
    };
  }
}
