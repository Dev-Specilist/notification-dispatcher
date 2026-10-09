import { SQL, sql } from 'drizzle-orm';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import { AlarmId, RecipientId } from '@/modules/notification/domain/alarm/alarm.type';
import { Delivery } from '@/modules/notification/domain/delivery/delivery.entity';
import { DeliveryPredicates } from '@/modules/notification/domain/delivery/delivery.predicate';
import {
  DeliveryId,
  DeliverySnapshot,
  DeliveryState,
  FailureReason,
  LeaseToken,
  MessageId,
  RequestRecord,
  RetryCause,
} from '@/modules/notification/domain/delivery/delivery.type';
import {
  DeliveryInsert,
  DeliveryRow,
  DeliveryUpdate,
} from '@/modules/notification/adapter/out/persistence/notification-database.type';

interface StateColumns {
  readonly status: DeliveryRow['status'];
  readonly leaseToken: LeaseToken | SQL;
  readonly leaseExpiresAt: Date | SQL;
  readonly requestStartedAt: Date | SQL;
  readonly retryAt: Date | SQL;
  readonly retryCause: RetryCause | SQL;
  readonly unknownSince: Date | SQL;
  readonly reconcileAt: Date | SQL;
  readonly lookupFailures: number | SQL;
  readonly messageId: MessageId | SQL;
  readonly sentAt: Date | SQL;
  readonly duplicateCount: number | SQL;
  readonly failureReason: FailureReason | SQL;
  readonly unconfirmedAt: Date | SQL;
  readonly cancelledAt: Date | SQL;
}

type ClearedColumns = Omit<StateColumns, 'status'>;

export class DeliveryRowMapper {
  private static readonly CLEARED: SQL = sql`NULL`;

  private static readonly RETRY_CAUSES: ReadonlySet<string> = new Set<RetryCause>([
    'TRANSIENT_FAILURE',
    'RATE_LIMITED',
    'UNREACHABLE',
    'NOT_DELIVERED',
  ]);

  private static readonly FAILURE_REASONS: ReadonlySet<string> = new Set<FailureReason>([
    'RECIPIENT_BLOCKED',
    'UNKNOWN_RECIPIENT',
    'INVALID_REQUEST',
    'RETRY_EXHAUSTED',
  ]);

  private static readonly NO_STATE_COLUMNS: ClearedColumns = {
    leaseToken: DeliveryRowMapper.CLEARED,
    leaseExpiresAt: DeliveryRowMapper.CLEARED,
    requestStartedAt: DeliveryRowMapper.CLEARED,
    retryAt: DeliveryRowMapper.CLEARED,
    retryCause: DeliveryRowMapper.CLEARED,
    unknownSince: DeliveryRowMapper.CLEARED,
    reconcileAt: DeliveryRowMapper.CLEARED,
    lookupFailures: DeliveryRowMapper.CLEARED,
    messageId: DeliveryRowMapper.CLEARED,
    sentAt: DeliveryRowMapper.CLEARED,
    duplicateCount: DeliveryRowMapper.CLEARED,
    failureReason: DeliveryRowMapper.CLEARED,
    unconfirmedAt: DeliveryRowMapper.CLEARED,
    cancelledAt: DeliveryRowMapper.CLEARED,
  };

  static toInsert(delivery: Delivery): DeliveryInsert {
    const { id, alarmId, recipientId, priority, attempts, state, createdAt }: DeliverySnapshot =
      delivery.snapshot();
    return {
      id,
      alarmId,
      recipientId,
      priority,
      attempts,
      createdAt,
      ...DeliveryRowMapper.toStateColumns(state),
    };
  }

  static toUpdate(delivery: Delivery): DeliveryUpdate {
    const { attempts, state }: DeliverySnapshot = delivery.snapshot();
    return {
      attempts,
      ...DeliveryRowMapper.toStateColumns(state),
      updatedAt: sql`now()`,
    };
  }

  static toStateColumns(state: DeliveryState): StateColumns {
    const cleared: ClearedColumns = DeliveryRowMapper.NO_STATE_COLUMNS;
    switch (state.status) {
      case 'PENDING':
        return { ...cleared, status: 'PENDING' };
      case 'IN_FLIGHT':
        return {
          ...cleared,
          status: 'IN_FLIGHT',
          leaseToken: state.lease.token,
          leaseExpiresAt: state.lease.expiresAt,
          requestStartedAt:
            state.request.kind === 'STARTED' ? state.request.at : DeliveryRowMapper.CLEARED,
        };
      case 'RETRY_WAIT':
        return {
          ...cleared,
          status: 'RETRY_WAIT',
          retryAt: state.retryAt,
          retryCause: state.cause,
        };
      case 'UNKNOWN':
        return {
          ...cleared,
          status: 'UNKNOWN',
          unknownSince: state.unknownSince,
          reconcileAt: state.reconcileAt,
          lookupFailures: state.lookupFailures,
        };
      case 'SENT':
        return {
          ...cleared,
          status: 'SENT',
          messageId: state.messageId,
          sentAt: state.sentAt,
          duplicateCount: state.duplicateCount,
        };
      case 'FAILED':
        return { ...cleared, status: 'FAILED', failureReason: state.reason };
      case 'UNCONFIRMED':
        return {
          ...cleared,
          status: 'UNCONFIRMED',
          unknownSince: state.unknownSince,
          unconfirmedAt: state.unconfirmedAt,
        };
      case 'CANCELLED':
        break;
    }
    return { ...cleared, status: 'CANCELLED', cancelledAt: state.cancelledAt };
  }

  static toDelivery(row: DeliveryRow): Delivery {
    const { priority, attempts, createdAt }: DeliveryRow = row;
    return Delivery.reconstitute({
      id: DeliveryRowMapper.deliveryIdOf(row),
      alarmId: DeliveryRowMapper.alarmIdOf(row),
      recipientId: DeliveryRowMapper.recipientIdOf(row),
      priority,
      attempts,
      state: DeliveryRowMapper.stateOf(row),
      createdAt,
    });
  }

  private static deliveryIdOf({ id: rawDeliveryId }: DeliveryRow): DeliveryId {
    if (!DeliveryPredicates.isDeliveryId(rawDeliveryId)) {
      throw new Error(`delivery row has an invalid id: ${rawDeliveryId}`);
    }
    return rawDeliveryId;
  }

  private static alarmIdOf({ id, alarmId }: DeliveryRow): AlarmId {
    if (!AlarmPredicates.isAlarmId(alarmId)) {
      throw new Error(`delivery row ${id} has an invalid alarm id: ${alarmId}`);
    }
    return alarmId;
  }

  private static recipientIdOf({ id, recipientId }: DeliveryRow): RecipientId {
    if (!AlarmPredicates.isRecipientId(recipientId)) {
      throw new Error(`delivery row ${id} has an invalid recipient id: ${recipientId}`);
    }
    return recipientId;
  }

  private static stateOf(row: DeliveryRow): DeliveryState {
    switch (row.status) {
      case 'PENDING':
        return { status: 'PENDING' };
      case 'IN_FLIGHT':
        return DeliveryRowMapper.inFlightOf(row);
      case 'RETRY_WAIT':
        return DeliveryRowMapper.retryWaitOf(row);
      case 'UNKNOWN':
        return DeliveryRowMapper.unknownOf(row);
      case 'SENT':
        return DeliveryRowMapper.sentOf(row);
      case 'FAILED':
        return DeliveryRowMapper.failedOf(row);
      case 'UNCONFIRMED':
        return DeliveryRowMapper.unconfirmedOf(row);
      case 'CANCELLED':
        break;
    }
    return DeliveryRowMapper.cancelledOf(row);
  }

  private static inFlightOf(row: DeliveryRow): DeliveryState {
    const { leaseToken, leaseExpiresAt, requestStartedAt }: DeliveryRow = row;
    if (
      typeof leaseToken !== 'string' ||
      !DeliveryPredicates.isLeaseToken(leaseToken) ||
      !(leaseExpiresAt instanceof Date)
    ) {
      throw DeliveryRowMapper.mismatch(row);
    }
    const request: RequestRecord =
      requestStartedAt instanceof Date
        ? { kind: 'STARTED', at: requestStartedAt }
        : { kind: 'NOT_STARTED' };
    return {
      status: 'IN_FLIGHT',
      lease: { token: leaseToken, expiresAt: leaseExpiresAt },
      request,
    };
  }

  private static retryWaitOf(row: DeliveryRow): DeliveryState {
    const { retryAt, retryCause }: DeliveryRow = row;
    if (!(retryAt instanceof Date) || !DeliveryRowMapper.isRetryCause(retryCause)) {
      throw DeliveryRowMapper.mismatch(row);
    }
    return { status: 'RETRY_WAIT', retryAt, cause: retryCause };
  }

  private static unknownOf(row: DeliveryRow): DeliveryState {
    const { unknownSince, reconcileAt, lookupFailures }: DeliveryRow = row;
    if (
      !(unknownSince instanceof Date) ||
      !(reconcileAt instanceof Date) ||
      !DeliveryRowMapper.isNonNegativeInteger(lookupFailures)
    ) {
      throw DeliveryRowMapper.mismatch(row);
    }
    return { status: 'UNKNOWN', unknownSince, reconcileAt, lookupFailures };
  }

  private static sentOf(row: DeliveryRow): DeliveryState {
    const { messageId, sentAt, duplicateCount }: DeliveryRow = row;
    if (
      typeof messageId !== 'string' ||
      !DeliveryPredicates.isMessageId(messageId) ||
      !(sentAt instanceof Date) ||
      !DeliveryRowMapper.isNonNegativeInteger(duplicateCount)
    ) {
      throw DeliveryRowMapper.mismatch(row);
    }
    return { status: 'SENT', messageId, sentAt, duplicateCount };
  }

  private static failedOf(row: DeliveryRow): DeliveryState {
    const { failureReason }: DeliveryRow = row;
    if (!DeliveryRowMapper.isFailureReason(failureReason)) {
      throw DeliveryRowMapper.mismatch(row);
    }
    return { status: 'FAILED', reason: failureReason };
  }

  private static unconfirmedOf(row: DeliveryRow): DeliveryState {
    const { unknownSince, unconfirmedAt }: DeliveryRow = row;
    if (!(unknownSince instanceof Date) || !(unconfirmedAt instanceof Date)) {
      throw DeliveryRowMapper.mismatch(row);
    }
    return { status: 'UNCONFIRMED', unknownSince, unconfirmedAt };
  }

  private static cancelledOf(row: DeliveryRow): DeliveryState {
    const { cancelledAt }: DeliveryRow = row;
    if (!(cancelledAt instanceof Date)) {
      throw DeliveryRowMapper.mismatch(row);
    }
    return { status: 'CANCELLED', cancelledAt };
  }

  private static isRetryCause(value: DeliveryRow['retryCause']): value is RetryCause {
    return typeof value === 'string' && DeliveryRowMapper.RETRY_CAUSES.has(value);
  }

  private static isFailureReason(value: DeliveryRow['failureReason']): value is FailureReason {
    return typeof value === 'string' && DeliveryRowMapper.FAILURE_REASONS.has(value);
  }

  private static isNonNegativeInteger(value: DeliveryRow['lookupFailures']): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  }

  private static mismatch({ id, status }: DeliveryRow): Error {
    return new Error(`delivery row ${id} has columns that do not match status ${status}`);
  }
}
