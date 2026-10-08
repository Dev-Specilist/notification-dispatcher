import type { InMemoryAlarmRepositoryAdapter } from '@/modules/notification/adapter/out/in-memory/in-memory-alarm-repository.adapter';
import type { InMemoryDeliveryRepositoryAdapter } from '@/modules/notification/adapter/out/in-memory/in-memory-delivery-repository.adapter';
import type { InMemoryExpansionJobRepositoryAdapter } from '@/modules/notification/adapter/out/in-memory/in-memory-expansion-job-repository.adapter';

export interface InMemoryRepositories {
  readonly alarmRepository: InMemoryAlarmRepositoryAdapter;
  readonly deliveryRepository: InMemoryDeliveryRepositoryAdapter;
  readonly expansionJobRepository: InMemoryExpansionJobRepositoryAdapter;
}
