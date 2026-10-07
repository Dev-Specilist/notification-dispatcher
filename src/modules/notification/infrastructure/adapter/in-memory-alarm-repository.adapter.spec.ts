import { describe } from 'vitest';
import { AlarmRepositoryContract } from '@/modules/notification/application/port/alarm-repository.contract';
import { InMemoryAlarmRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-alarm-repository.adapter';

describe('InMemoryAlarmRepositoryAdapter', () => {
  AlarmRepositoryContract.verify((): Promise<InMemoryAlarmRepositoryAdapter> =>
    Promise.resolve(new InMemoryAlarmRepositoryAdapter()),
  );
});
