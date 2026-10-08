import { Injectable } from '@nestjs/common';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import { AlarmId, DeliveryCount } from '@/modules/notification/domain/alarm/alarm.type';
import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';
import {
  DeliveryId,
  DeliverySnapshot,
  DeliveryStatusCounts,
  DeliveryStatusTally,
  DeliveryTransition,
  LeaseToken,
} from '@/modules/notification/domain/delivery/delivery.type';
import { DeliveryStatusCountsFactory } from '@/modules/notification/domain/delivery/delivery-status-counts.factory';
import {
  DeliveryCandidate,
  LeasedSave,
  ReconciledSave,
} from '@/modules/notification/application/port/out/delivery-repository.type';
import { DeliveryCreationPort } from '@/modules/notification/application/port/out/delivery-creation.port';
import { DispatchQueuePort } from '@/modules/notification/application/port/out/dispatch-queue.port';
import { LeaseRecoveryQueuePort } from '@/modules/notification/application/port/out/lease-recovery-queue.port';
import { ReconcileQueuePort } from '@/modules/notification/application/port/out/reconcile-queue.port';
import { DeliveryCancellationPort } from '@/modules/notification/application/port/out/delivery-cancellation.port';
import { DeliveryProgressPort } from '@/modules/notification/application/port/out/delivery-progress.port';
import { Rollback } from '@/modules/notification/adapter/out/in-memory/rollback.type';

@Injectable()
export class InMemoryDeliveryRepositoryAdapter
  implements
    DeliveryCreationPort,
    DispatchQueuePort,
    LeaseRecoveryQueuePort,
    ReconcileQueuePort,
    DeliveryCancellationPort,
    DeliveryProgressPort
{
  private readonly deliveriesById: Map<DeliveryId, Delivery> = new Map<DeliveryId, Delivery>();

  private readonly deliveryIdsByRecipient: Map<string, DeliveryId> = new Map<string, DeliveryId>();

  saveAll(deliveries: ReadonlyArray<Delivery>): Promise<void> {
    if (!this.keepsOneDeliveryPerRecipient(deliveries)) {
      return Promise.reject(
        new Error('a delivery for the same alarm and recipient already exists with another id'),
      );
    }
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
      [...this.deliveriesById.values()]
        .filter((delivery: Delivery): boolean => delivery.snapshot().alarmId === alarmId)
        .toSorted((left: Delivery, right: Delivery): number =>
          InMemoryDeliveryRepositoryAdapter.byCreation(left, right),
        ),
    );
  }

  findNextClaimable(now: Readonly<Date>): Promise<DeliveryCandidate> {
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

  findNextExpiredLease(now: Readonly<Date>): Promise<DeliveryCandidate> {
    const expired: ReadonlyArray<Delivery> = [...this.deliveriesById.values()].filter(
      (delivery: Delivery): boolean => delivery.hasExpiredLeaseAt(now),
    );
    if (expired.length === 0) {
      return Promise.resolve({ kind: 'none' });
    }
    const [first, ...rest]: ReadonlyArray<Delivery> = expired;
    const next: Delivery = rest.reduce(
      (earliest: Delivery, candidate: Delivery): Delivery =>
        InMemoryDeliveryRepositoryAdapter.leaseExpiryOf(candidate) <
        InMemoryDeliveryRepositoryAdapter.leaseExpiryOf(earliest)
          ? candidate
          : earliest,
      first,
    );
    return Promise.resolve({ kind: 'found', delivery: next });
  }

  findNextReconcilable(now: Readonly<Date>): Promise<DeliveryCandidate> {
    const reconcilable: ReadonlyArray<Delivery> = [...this.deliveriesById.values()].filter(
      (delivery: Delivery): boolean => delivery.isReconcilableAt(now),
    );
    if (reconcilable.length === 0) {
      return Promise.resolve({ kind: 'none' });
    }
    const [first, ...rest]: ReadonlyArray<Delivery> = reconcilable;
    const next: Delivery = rest.reduce(
      (earliest: Delivery, candidate: Delivery): Delivery =>
        InMemoryDeliveryRepositoryAdapter.byReconcileOrder(candidate, earliest) < 0
          ? candidate
          : earliest,
      first,
    );
    return Promise.resolve({ kind: 'found', delivery: next });
  }

  saveReconciled(delivery: Delivery, previous: Delivery): Promise<ReconciledSave> {
    const { id }: DeliverySnapshot = delivery.snapshot();
    const current: Delivery = this.deliveriesById.get(id) ?? delivery;
    const unchanged: boolean =
      this.deliveriesById.has(id) &&
      InMemoryDeliveryRepositoryAdapter.reconcileVersionOf(current) ===
        InMemoryDeliveryRepositoryAdapter.reconcileVersionOf(previous);
    if (!unchanged) {
      return Promise.resolve({ kind: 'superseded' });
    }
    this.store(delivery);
    return Promise.resolve({ kind: 'saved' });
  }

  saveLeased(delivery: Delivery, token: LeaseToken): Promise<LeasedSave> {
    if (!this.isStillLeasedBy(delivery, token)) {
      return Promise.resolve({ kind: 'lease-lost' });
    }
    this.store(delivery);
    return Promise.resolve({ kind: 'saved' });
  }

  async countUnsettled(alarmId: AlarmId): Promise<DeliveryCount> {
    const unsettled: number = (await this.findByAlarmId(alarmId)).filter(
      (delivery: Delivery): boolean => !delivery.isSettled(),
    ).length;
    if (!AlarmPredicates.isDeliveryCount(unsettled)) {
      throw new Error(`unsettled delivery count ${unsettled} is not a valid DeliveryCount`);
    }
    return unsettled;
  }

  async countByStatus(alarmId: AlarmId): Promise<DeliveryStatusCounts> {
    const deliveries: ReadonlyArray<Delivery> = await this.findByAlarmId(alarmId);
    return DeliveryStatusCountsFactory.fromTallies(
      deliveries.map((delivery: Delivery): DeliveryStatusTally => ({
        status: delivery.snapshot().state.status,
        count: 1,
      })),
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

  private isStillLeasedBy(delivery: Delivery, token: LeaseToken): boolean {
    const { id }: DeliverySnapshot = delivery.snapshot();
    const current: Delivery = this.deliveriesById.get(id) ?? delivery;
    return (
      this.deliveriesById.has(id) && InMemoryDeliveryRepositoryAdapter.isLeasedBy(current, token)
    );
  }

  private keepsOneDeliveryPerRecipient(deliveries: ReadonlyArray<Delivery>): boolean {
    const idsByRecipient: Map<string, DeliveryId> = new Map<string, DeliveryId>(
      this.deliveryIdsByRecipient,
    );
    return deliveries.every((delivery: Delivery): boolean => {
      const { id }: DeliverySnapshot = delivery.snapshot();
      const recipientKey: string = InMemoryDeliveryRepositoryAdapter.recipientKeyOf(delivery);
      if (idsByRecipient.has(recipientKey) && idsByRecipient.get(recipientKey) !== id) {
        return false;
      }
      idsByRecipient.set(recipientKey, id);
      return true;
    });
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

  private static byReconcileOrder(left: Delivery, right: Delivery): number {
    const gap: number =
      InMemoryDeliveryRepositoryAdapter.reconcileAtOf(left) -
      InMemoryDeliveryRepositoryAdapter.reconcileAtOf(right);
    return gap === 0 ? left.snapshot().id.localeCompare(right.snapshot().id) : gap;
  }

  private static leaseExpiryOf(delivery: Delivery): number {
    const { state }: DeliverySnapshot = delivery.snapshot();
    return state.status === 'IN_FLIGHT'
      ? state.lease.expiresAt.getTime()
      : Number.POSITIVE_INFINITY;
  }

  private static reconcileAtOf(delivery: Delivery): number {
    const { state }: DeliverySnapshot = delivery.snapshot();
    return state.status === 'UNKNOWN' ? state.reconcileAt.getTime() : Number.POSITIVE_INFINITY;
  }

  private static reconcileVersionOf(delivery: Delivery): string {
    const { state }: DeliverySnapshot = delivery.snapshot();
    return state.status === 'UNKNOWN'
      ? `UNKNOWN:${state.reconcileAt.toISOString()}:${state.lookupFailures}`
      : state.status;
  }

  private static byCreation(left: Delivery, right: Delivery): number {
    const first: DeliverySnapshot = left.snapshot();
    const second: DeliverySnapshot = right.snapshot();
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
