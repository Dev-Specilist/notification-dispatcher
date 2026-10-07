import { Injectable } from '@nestjs/common';
import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';
import {
  DeliveryId,
  DeliverySnapshot,
  DeliveryTransition,
} from '@/modules/notification/domain/delivery/delivery.type';
import { DeliveryRepositoryPort } from '@/modules/notification/application/port/delivery-repository.port';
import { Rollback } from '@/modules/notification/infrastructure/adapter/rollback.type';

@Injectable()
export class InMemoryDeliveryRepositoryAdapter implements DeliveryRepositoryPort {
  private readonly deliveriesById: Map<DeliveryId, Delivery> = new Map<DeliveryId, Delivery>();

  private readonly deliveryIdsByRecipient: Map<string, DeliveryId> = new Map<string, DeliveryId>();

  saveAll(deliveries: ReadonlyArray<Delivery>): Promise<void> {
    deliveries.forEach((delivery: Delivery): void => this.store(delivery));
    return Promise.resolve();
  }

  insertMissing(deliveries: ReadonlyArray<Delivery>): Promise<void> {
    deliveries.forEach((delivery: Delivery): void => {
      if (
        !this.deliveryIdsByRecipient.has(InMemoryDeliveryRepositoryAdapter.recipientKeyOf(delivery))
      ) {
        this.store(delivery);
      }
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
        this.store(transition.delivery);
      }
    });
  }

  checkpoint(): Rollback {
    const savedDeliveries: Map<DeliveryId, Delivery> = new Map<DeliveryId, Delivery>(
      this.deliveriesById,
    );
    const savedIndex: Map<string, DeliveryId> = new Map<string, DeliveryId>(
      this.deliveryIdsByRecipient,
    );
    return (): void => {
      InMemoryDeliveryRepositoryAdapter.restore(this.deliveriesById, savedDeliveries);
      InMemoryDeliveryRepositoryAdapter.restore(this.deliveryIdsByRecipient, savedIndex);
    };
  }

  private store(delivery: Delivery): void {
    const { id }: DeliverySnapshot = delivery.snapshot();
    this.deliveriesById.set(id, delivery);
    this.deliveryIdsByRecipient.set(InMemoryDeliveryRepositoryAdapter.recipientKeyOf(delivery), id);
  }

  private static recipientKeyOf(delivery: Delivery): string {
    const { alarmId, recipientId }: DeliverySnapshot = delivery.snapshot();
    return `${alarmId}:${recipientId}`;
  }

  private static restore<TKey, TValue>(
    target: Map<TKey, TValue>,
    saved: ReadonlyMap<TKey, TValue>,
  ): void {
    target.clear();
    saved.forEach((value: TValue, key: TKey): void => {
      target.set(key, value);
    });
  }
}
