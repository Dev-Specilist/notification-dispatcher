import { describe } from 'vitest';
import { ExpansionJobRepositoryContract } from '@/modules/notification/application/port/out/expansion-job-repository.contract';
import { InMemoryAlarmRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-alarm-repository.adapter';
import { InMemoryExpansionJobRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-expansion-job-repository.adapter';

describe('InMemoryExpansionJobRepositoryAdapter', () => {
  ExpansionJobRepositoryContract.verify(() =>
    Promise.resolve({
      alarmRepository: new InMemoryAlarmRepositoryAdapter(),
      expansionJobRepository: new InMemoryExpansionJobRepositoryAdapter(),
    }),
  );
});
