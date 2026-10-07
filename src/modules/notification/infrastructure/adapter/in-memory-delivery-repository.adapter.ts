import { Injectable } from '@nestjs/common';
import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';
import {
  DeliveryId,
  DeliveryTransition,
} from '@/modules/notification/domain/delivery/delivery.type';
import { DeliveryRepositoryPort } from '@/modules/notification/application/port/delivery-repository.port';
import { Rollback } from '@/modules/notification/infrastructure/adapter/rollback.type';

@Injectable()
export class InMemoryDeliveryRepositoryAdapter implements DeliveryRepositoryPort {
  private readonly deliveriesById: Map<DeliveryId, Delivery> = new Map<DeliveryId, Delivery>();

  saveAll(deliveries: ReadonlyArray<Delivery>): Promise<void> {
    deliveries.forEach((delivery: Delivery): void => {
      this.deliveriesById.set(delivery.snapshot().id, delivery);
    });
    return Promise.resolve();
  }

  findByAlarmId(alarmId: AlarmId): Promise<ReadonlyArray<Delivery>> {
    return Promise.resolve(
      [...this.deliveriesById.values()].filter(
        (delivery: Delivery): boolean => delivery.snapshot().alarmId === alarmId,
      ),
    );
  }

  async cancelWaiting(alarmId: AlarmId, now: Readonly<Date>): Promise<void> {
    const deliveries: ReadonlyArray<Delivery> = await this.findByAlarmId(alarmId);
    deliveries.forEach((delivery: Delivery): void => {
      const transition: DeliveryTransition = delivery.cancel(now);
      if (transition.kind === 'transitioned') {
        this.deliveriesById.set(delivery.snapshot().id, transition.delivery);
      }
    });
  }

  checkpoint(): Rollback {
    const saved: Map<DeliveryId, Delivery> = new Map<DeliveryId, Delivery>(this.deliveriesById);
    return (): void => {
      this.deliveriesById.clear();
      saved.forEach((value: Delivery, key: DeliveryId): void => {
        this.deliveriesById.set(key, value);
      });
    };
  }
}
