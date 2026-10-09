import { SQL, and, asc, count, eq, inArray, lte, notInArray, or, sql } from 'drizzle-orm';
import { PgColumn } from 'drizzle-orm/pg-core';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import { AlarmId, DeliveryCount } from '@/modules/notification/domain/alarm/alarm.type';
import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';
import {
  DeliverySnapshot,
  DeliveryStatusCounts,
  DeliveryStatusTally,
  LeaseToken,
} from '@/modules/notification/domain/delivery/delivery.type';
import { DeliveryStatusCountsFactory } from '@/modules/notification/domain/delivery/delivery-status-counts.factory';
import { DeliveryCreationPort } from '@/modules/notification/application/port/driven/for-storing-deliveries/delivery-creation.port';
import { DispatchQueuePort } from '@/modules/notification/application/port/driven/for-storing-deliveries/dispatch-queue.port';
import { LeaseRecoveryQueuePort } from '@/modules/notification/application/port/driven/for-storing-deliveries/lease-recovery-queue.port';
import { ReconcileQueuePort } from '@/modules/notification/application/port/driven/for-storing-deliveries/reconcile-queue.port';
import { DeliveryCancellationPort } from '@/modules/notification/application/port/driven/for-storing-deliveries/delivery-cancellation.port';
import { DeliveryProgressPort } from '@/modules/notification/application/port/driven/for-storing-deliveries/delivery-progress.port';
import {
  DeliveryCandidate,
  LeasedSave,
  ReconciledSave,
} from '@/modules/notification/application/port/driven/for-storing-deliveries/delivery-repository.type';
import { deliveries } from '@/modules/notification/adapter/driven/persistence/delivery/delivery.table';
import { DeliveryRowMapper } from '@/modules/notification/adapter/driven/persistence/delivery/delivery-row.mapper';
import {
  DeliveryInsert,
  DeliveryRow,
  DeliveryUpdate,
  NotificationDatabase,
} from '@/modules/notification/adapter/driven/persistence/notification-database.type';

interface UpdatedId {
  readonly id: string;
}

interface CountRow {
  readonly total: number;
}

export class DrizzleDeliveryRepositoryAdapter
  implements
    DeliveryCreationPort,
    DispatchQueuePort,
    LeaseRecoveryQueuePort,
    ReconcileQueuePort,
    DeliveryCancellationPort,
    DeliveryProgressPort
{
  private static readonly SETTLED_STATUSES: ReadonlyArray<DeliveryRow['status']> = [
    'SENT',
    'FAILED',
    'UNCONFIRMED',
    'CANCELLED',
  ];

  private static readonly UPSERT_FROM_EXCLUDED: DeliveryUpdate = {
    attempts: DrizzleDeliveryRepositoryAdapter.excluded(deliveries.attempts),
    status: DrizzleDeliveryRepositoryAdapter.excluded(deliveries.status),
    leaseToken: DrizzleDeliveryRepositoryAdapter.excluded(deliveries.leaseToken),
    leaseExpiresAt: DrizzleDeliveryRepositoryAdapter.excluded(deliveries.leaseExpiresAt),
    requestStartedAt: DrizzleDeliveryRepositoryAdapter.excluded(deliveries.requestStartedAt),
    retryAt: DrizzleDeliveryRepositoryAdapter.excluded(deliveries.retryAt),
    retryCause: DrizzleDeliveryRepositoryAdapter.excluded(deliveries.retryCause),
    unknownSince: DrizzleDeliveryRepositoryAdapter.excluded(deliveries.unknownSince),
    reconcileAt: DrizzleDeliveryRepositoryAdapter.excluded(deliveries.reconcileAt),
    lookupFailures: DrizzleDeliveryRepositoryAdapter.excluded(deliveries.lookupFailures),
    messageId: DrizzleDeliveryRepositoryAdapter.excluded(deliveries.messageId),
    sentAt: DrizzleDeliveryRepositoryAdapter.excluded(deliveries.sentAt),
    duplicateCount: DrizzleDeliveryRepositoryAdapter.excluded(deliveries.duplicateCount),
    failureReason: DrizzleDeliveryRepositoryAdapter.excluded(deliveries.failureReason),
    unconfirmedAt: DrizzleDeliveryRepositoryAdapter.excluded(deliveries.unconfirmedAt),
    cancelledAt: DrizzleDeliveryRepositoryAdapter.excluded(deliveries.cancelledAt),
    updatedAt: sql`now()`,
  };

  constructor(private readonly database: NotificationDatabase) {}

  async saveAll(items: ReadonlyArray<Delivery>): Promise<void> {
    if (items.length === 0) {
      return;
    }
    await this.database
      .insert(deliveries)
      .values(
        items.map((delivery: Delivery): DeliveryInsert => DeliveryRowMapper.toInsert(delivery)),
      )
      .onConflictDoUpdate({
        target: deliveries.id,
        set: DrizzleDeliveryRepositoryAdapter.UPSERT_FROM_EXCLUDED,
      });
  }

  async insertMissing(items: ReadonlyArray<Delivery>): Promise<void> {
    if (items.length === 0) {
      return;
    }
    await this.database
      .insert(deliveries)
      .values(
        items.map((delivery: Delivery): DeliveryInsert => DeliveryRowMapper.toInsert(delivery)),
      )
      .onConflictDoNothing({ target: [deliveries.alarmId, deliveries.recipientId] });
  }

  async findByAlarmId(alarmId: AlarmId): Promise<ReadonlyArray<Delivery>> {
    const rows: ReadonlyArray<DeliveryRow> = await this.database
      .select()
      .from(deliveries)
      .where(eq(deliveries.alarmId, alarmId))
      .orderBy(asc(deliveries.createdAt), asc(deliveries.id));
    return rows.map((row: DeliveryRow): Delivery => DeliveryRowMapper.toDelivery(row));
  }

  async findNextClaimable(now: Readonly<Date>): Promise<DeliveryCandidate> {
    return this.lockFirst(
      or(
        eq(deliveries.status, 'PENDING'),
        and(eq(deliveries.status, 'RETRY_WAIT'), lte(deliveries.retryAt, new Date(now.getTime()))),
      ),
      [asc(deliveries.priorityRank), asc(deliveries.createdAt), asc(deliveries.id)],
    );
  }

  async saveLeased(delivery: Delivery, token: LeaseToken): Promise<LeasedSave> {
    const updated: ReadonlyArray<UpdatedId> = await this.database
      .update(deliveries)
      .set(DeliveryRowMapper.toUpdate(delivery))
      .where(
        and(
          eq(deliveries.id, delivery.snapshot().id),
          eq(deliveries.status, 'IN_FLIGHT'),
          eq(deliveries.leaseToken, token),
        ),
      )
      .returning({ id: deliveries.id });
    return updated.length === 0 ? { kind: 'lease-lost' } : { kind: 'saved' };
  }

  async findNextReconcilable(now: Readonly<Date>): Promise<DeliveryCandidate> {
    return this.lockFirst(
      and(eq(deliveries.status, 'UNKNOWN'), lte(deliveries.reconcileAt, new Date(now.getTime()))),
      [asc(deliveries.reconcileAt), asc(deliveries.id)],
    );
  }

  async saveReconciled(delivery: Delivery, previous: Delivery): Promise<ReconciledSave> {
    const { id, state }: DeliverySnapshot = previous.snapshot();
    if (state.status !== 'UNKNOWN') {
      return { kind: 'superseded' };
    }
    const updated: ReadonlyArray<UpdatedId> = await this.database
      .update(deliveries)
      .set(DeliveryRowMapper.toUpdate(delivery))
      .where(
        and(
          eq(deliveries.id, id),
          eq(deliveries.status, 'UNKNOWN'),
          eq(deliveries.reconcileAt, state.reconcileAt),
          eq(deliveries.lookupFailures, state.lookupFailures),
        ),
      )
      .returning({ id: deliveries.id });
    return updated.length === 0 ? { kind: 'superseded' } : { kind: 'saved' };
  }

  async findNextExpiredLease(now: Readonly<Date>): Promise<DeliveryCandidate> {
    return this.lockFirst(
      and(
        eq(deliveries.status, 'IN_FLIGHT'),
        lte(deliveries.leaseExpiresAt, new Date(now.getTime())),
      ),
      [asc(deliveries.leaseExpiresAt), asc(deliveries.id)],
    );
  }

  async countUnsettled(alarmId: AlarmId): Promise<DeliveryCount> {
    const [result]: ReadonlyArray<CountRow> = await this.database
      .select({ total: count() })
      .from(deliveries)
      .where(
        and(
          eq(deliveries.alarmId, alarmId),
          notInArray(deliveries.status, [...DrizzleDeliveryRepositoryAdapter.SETTLED_STATUSES]),
        ),
      );
    const { total }: CountRow = result;
    if (!AlarmPredicates.isDeliveryCount(total)) {
      throw new Error(`unsettled delivery count ${total} is not a valid DeliveryCount`);
    }
    return total;
  }

  async countByStatus(alarmId: AlarmId): Promise<DeliveryStatusCounts> {
    const tallies: ReadonlyArray<DeliveryStatusTally> = await this.database
      .select({ status: deliveries.status, count: count() })
      .from(deliveries)
      .where(eq(deliveries.alarmId, alarmId))
      .groupBy(deliveries.status);
    return DeliveryStatusCountsFactory.fromTallies(tallies);
  }

  async cancelWaiting(alarmId: AlarmId, now: Readonly<Date>): Promise<void> {
    await this.database
      .update(deliveries)
      .set({
        ...DeliveryRowMapper.toStateColumns({
          status: 'CANCELLED',
          cancelledAt: new Date(now.getTime()),
        }),
        updatedAt: sql`now()`,
      })
      .where(
        and(eq(deliveries.alarmId, alarmId), inArray(deliveries.status, ['PENDING', 'RETRY_WAIT'])),
      );
  }

  private static excluded(column: PgColumn): SQL {
    return sql.raw(`excluded."${column.name}"`);
  }

  private async lockFirst(
    condition: SQL | ReturnType<typeof and>,
    ordering: ReadonlyArray<SQL>,
  ): Promise<DeliveryCandidate> {
    const rows: ReadonlyArray<DeliveryRow> = await this.database
      .select()
      .from(deliveries)
      .where(condition)
      .orderBy(...ordering)
      .limit(1)
      .for('update', { skipLocked: true });
    if (rows.length === 0) {
      return { kind: 'none' };
    }
    const [row]: ReadonlyArray<DeliveryRow> = rows;
    return { kind: 'found', delivery: DeliveryRowMapper.toDelivery(row) };
  }
}
