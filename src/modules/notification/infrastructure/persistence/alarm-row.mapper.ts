import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import {
  AlarmAudience,
  AlarmId,
  AlarmSnapshot,
  AlarmState,
  RecipientId,
} from '@/modules/notification/domain/alarm/alarm.type';
import {
  AlarmInsert,
  AlarmRow,
} from '@/modules/notification/infrastructure/persistence/notification-database.type';

type AlarmStateColumns = Pick<
  AlarmInsert,
  'status' | 'dispatchedAt' | 'completedAt' | 'cancelledAt'
>;

export class AlarmRowMapper {
  static toInsert(alarm: Alarm): AlarmInsert {
    const { id, title, body, kind, target, state, createdAt }: AlarmSnapshot = alarm.snapshot();
    return {
      id,
      title,
      body,
      kind,
      recipientIds: target.kind === 'EXPLICIT' ? [...target.recipientIds] : [],
      ...AlarmRowMapper.toStateColumns(state),
      createdAt,
    };
  }

  static toStateColumns(state: AlarmState): AlarmStateColumns {
    switch (state.status) {
      case 'DRAFT':
        return { status: 'DRAFT' };
      case 'DISPATCHING':
        return { status: 'DISPATCHING', dispatchedAt: state.dispatchedAt };
      case 'COMPLETED':
        return {
          status: 'COMPLETED',
          dispatchedAt: state.dispatchedAt,
          completedAt: state.completedAt,
        };
      case 'CANCELLED':
        break;
    }
    return state.dispatch.kind === 'STARTED'
      ? { status: 'CANCELLED', cancelledAt: state.cancelledAt, dispatchedAt: state.dispatch.at }
      : { status: 'CANCELLED', cancelledAt: state.cancelledAt };
  }

  static toAlarm(row: AlarmRow): Alarm {
    const { title, body, createdAt }: AlarmRow = row;
    return Alarm.reconstitute({
      id: AlarmRowMapper.alarmIdOf(row),
      title,
      body,
      ...AlarmRowMapper.audienceOf(row),
      state: AlarmRowMapper.stateOf(row),
      createdAt,
    });
  }

  private static alarmIdOf({ id }: AlarmRow): AlarmId {
    if (!AlarmPredicates.isAlarmId(id)) {
      throw new Error(`alarm row has an invalid id: ${id}`);
    }
    return id;
  }

  private static audienceOf({ id, kind, recipientIds }: AlarmRow): AlarmAudience {
    if (kind === 'BULK') {
      return { kind: 'BULK', target: { kind: 'ALL_USERS' } };
    }
    return {
      kind: 'URGENT',
      target: {
        kind: 'EXPLICIT',
        recipientIds: recipientIds.map((recipientId: string): RecipientId => {
          if (!AlarmPredicates.isRecipientId(recipientId)) {
            throw new Error(`alarm row ${id} has an invalid recipient id: ${recipientId}`);
          }
          return recipientId;
        }),
      },
    };
  }

  private static stateOf(row: AlarmRow): AlarmState {
    const { id, status, dispatchedAt, completedAt, cancelledAt }: AlarmRow = row;
    if (status === 'DRAFT') {
      return { status: 'DRAFT' };
    }
    if (status === 'DISPATCHING' && dispatchedAt instanceof Date) {
      return { status: 'DISPATCHING', dispatchedAt };
    }
    if (status === 'COMPLETED' && dispatchedAt instanceof Date && completedAt instanceof Date) {
      return { status: 'COMPLETED', dispatchedAt, completedAt };
    }
    if (status === 'CANCELLED' && cancelledAt instanceof Date) {
      return {
        status: 'CANCELLED',
        cancelledAt,
        dispatch:
          dispatchedAt instanceof Date ? { kind: 'STARTED', at: dispatchedAt } : { kind: 'NEVER' },
      };
    }
    throw new Error(`alarm row ${id} has timestamps that do not match status ${status}`);
  }
}
