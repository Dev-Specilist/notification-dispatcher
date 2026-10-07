import type { InMemoryAlarmRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-alarm-repository.adapter';
import type { InMemoryDeliveryRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-delivery-repository.adapter';
import type { InMemoryExpansionJobRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-expansion-job-repository.adapter';

export interface InMemoryRepositories {
  readonly alarmRepository: InMemoryAlarmRepositoryAdapter;
  readonly deliveryRepository: InMemoryDeliveryRepositoryAdapter;
  readonly expansionJobRepository: InMemoryExpansionJobRepositoryAdapter;
}
