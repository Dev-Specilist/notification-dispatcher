import { Injectable } from '@nestjs/common';
import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import { AlarmRepositoryPort } from '@/modules/notification/application/port/alarm-repository.port';
import {
  AlarmFound,
  AlarmLookup,
} from '@/modules/notification/application/port/alarm-repository.type';

@Injectable()
export class InMemoryAlarmRepositoryAdapter extends AlarmRepositoryPort {
  private readonly alarmsById: Map<AlarmId, AlarmFound> = new Map<AlarmId, AlarmFound>();

  save(alarm: Alarm): Promise<void> {
    this.alarmsById.set(alarm.snapshot().id, { kind: 'found', alarm });
    return Promise.resolve();
  }

  findById(id: AlarmId): Promise<AlarmLookup> {
    return Promise.resolve(this.alarmsById.get(id) ?? { kind: 'missing' });
  }
}
