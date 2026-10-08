import { describe } from 'vitest';
import { AlarmRepositoryContract } from '@/modules/notification/testing/contract/alarm-repository.contract';
import { InMemoryAlarmRepositoryAdapter } from '@/modules/notification/adapter/out/in-memory/in-memory-alarm-repository.adapter';

describe('InMemoryAlarmRepositoryAdapter', () => {
  AlarmRepositoryContract.verify((): Promise<InMemoryAlarmRepositoryAdapter> =>
    Promise.resolve(new InMemoryAlarmRepositoryAdapter()),
  );
});
