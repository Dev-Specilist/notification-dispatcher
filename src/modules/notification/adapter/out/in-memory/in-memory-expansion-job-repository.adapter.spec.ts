import { describe } from 'vitest';
import { ExpansionJobRepositoryContract } from '@/modules/notification/testing/contract/expansion-job-repository.contract';
import { InMemoryAlarmRepositoryAdapter } from '@/modules/notification/adapter/out/in-memory/in-memory-alarm-repository.adapter';
import { InMemoryExpansionJobRepositoryAdapter } from '@/modules/notification/adapter/out/in-memory/in-memory-expansion-job-repository.adapter';

describe('InMemoryExpansionJobRepositoryAdapter', () => {
  ExpansionJobRepositoryContract.verify(() =>
    Promise.resolve({
      alarmRepository: new InMemoryAlarmRepositoryAdapter(),
      expansionJobRepository: new InMemoryExpansionJobRepositoryAdapter(),
    }),
  );
});
