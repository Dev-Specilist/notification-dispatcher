import { describe } from 'vitest';
import { DeliveryRepositoryContract } from '@/modules/notification/testing/contract/delivery-repository.contract';
import { InMemoryAlarmRepositoryAdapter } from '@/modules/notification/testing/in-memory/in-memory-alarm-repository.adapter';
import { InMemoryDeliveryRepositoryAdapter } from '@/modules/notification/testing/in-memory/in-memory-delivery-repository.adapter';

describe('InMemoryDeliveryRepositoryAdapter', () => {
  DeliveryRepositoryContract.verify(() =>
    Promise.resolve({
      alarmRepository: new InMemoryAlarmRepositoryAdapter(),
      deliveryRepository: new InMemoryDeliveryRepositoryAdapter(),
    }),
  );
});
