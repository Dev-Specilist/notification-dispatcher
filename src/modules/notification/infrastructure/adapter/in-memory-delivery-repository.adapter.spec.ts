import { describe } from 'vitest';
import { DeliveryRepositoryContract } from '@/modules/notification/application/port/delivery-repository.contract';
import { InMemoryAlarmRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-alarm-repository.adapter';
import { InMemoryDeliveryRepositoryAdapter } from '@/modules/notification/infrastructure/adapter/in-memory-delivery-repository.adapter';

describe('InMemoryDeliveryRepositoryAdapter', () => {
  DeliveryRepositoryContract.verify(() =>
    Promise.resolve({
      alarmRepository: new InMemoryAlarmRepositoryAdapter(),
      deliveryRepository: new InMemoryDeliveryRepositoryAdapter(),
    }),
  );
});
