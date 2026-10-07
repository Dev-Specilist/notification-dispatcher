import { Injectable } from '@nestjs/common';
import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';
import {
  DeliveryId,
  DeliverySnapshot,
  DeliveryTransition,
  LeaseToken,
} from '@/modules/notification/domain/delivery/delivery.type';
import {
  ClaimableLookup,
  LeasedSave,
} from '@/modules/notification/application/port/delivery-repository.type';
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

  findNextClaimable(now: Readonly<Date>): Promise<ClaimableLookup> {
    const claimable: ReadonlyArray<Delivery> = [...this.deliveriesById.values()].filter(
      (delivery: Delivery): boolean => delivery.isClaimableAt(now),
    );
    if (claimable.length === 0) {
      return Promise.resolve({ kind: 'none' });
    }
    const [first, ...rest]: ReadonlyArray<Delivery> = claimable;
    const next: Delivery = rest.reduce(
      (earliest: Delivery, candidate: Delivery): Delivery =>
        InMemoryDeliveryRepositoryAdapter.byDispatchOrder(candidate, earliest) < 0
          ? candidate
          : earliest,
      first,
    );
    return Promise.resolve({ kind: 'found', delivery: next });
  }

  saveLeased(delivery: Delivery, token: LeaseToken): Promise<LeasedSave> {
    if (!this.isStillLeasedBy(delivery, token)) {
      return Promise.resolve({ kind: 'lease-lost' });
    }
    this.store(delivery);
    return Promise.resolve({ kind: 'saved' });
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

  private isStillLeasedBy(delivery: Delivery, token: LeaseToken): boolean {
    const { id }: DeliverySnapshot = delivery.snapshot();
    const current: Delivery = this.deliveriesById.get(id) ?? delivery;
    return (
      this.deliveriesById.has(id) && InMemoryDeliveryRepositoryAdapter.isLeasedBy(current, token)
    );
  }

  private store(delivery: Delivery): void {
    const { id }: DeliverySnapshot = delivery.snapshot();
    this.deliveriesById.set(id, delivery);
    this.deliveryIdsByRecipient.set(InMemoryDeliveryRepositoryAdapter.recipientKeyOf(delivery), id);
  }

  private static isLeasedBy(delivery: Delivery, token: LeaseToken): boolean {
    const { state }: DeliverySnapshot = delivery.snapshot();
    return state.status === 'IN_FLIGHT' && state.lease.token === token;
  }

  private static byDispatchOrder(left: Delivery, right: Delivery): number {
    const first: DeliverySnapshot = left.snapshot();
    const second: DeliverySnapshot = right.snapshot();
    const priorityGap: number =
      InMemoryDeliveryRepositoryAdapter.priorityRank(first) -
      InMemoryDeliveryRepositoryAdapter.priorityRank(second);
    if (priorityGap !== 0) {
      return priorityGap;
    }
    const ageGap: number = first.createdAt.getTime() - second.createdAt.getTime();
    return ageGap === 0 ? first.id.localeCompare(second.id) : ageGap;
  }

  private static priorityRank({ priority }: DeliverySnapshot): number {
    return priority === 'URGENT' ? 0 : 1;
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
