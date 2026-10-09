import { InMemoryAlarmRepositoryAdapter } from '@/modules/notification/testing/in-memory/in-memory-alarm-repository.adapter';
import { InMemoryDeliveryRepositoryAdapter } from '@/modules/notification/testing/in-memory/in-memory-delivery-repository.adapter';
import { InMemoryExpansionJobRepositoryAdapter } from '@/modules/notification/testing/in-memory/in-memory-expansion-job-repository.adapter';

export interface InMemoryRepositories {
  readonly alarmRepository: InMemoryAlarmRepositoryAdapter;
  readonly deliveryRepository: InMemoryDeliveryRepositoryAdapter;
  readonly expansionJobRepository: InMemoryExpansionJobRepositoryAdapter;
}
