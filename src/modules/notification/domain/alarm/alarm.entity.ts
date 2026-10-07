import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import {
  AlarmAudience,
  AlarmCreation,
  AlarmDraft,
  AlarmId,
  AlarmRejected,
  AlarmSnapshot,
  AlarmState,
  AlarmValidationError,
  CountRange,
  RecipientId,
} from '@/modules/notification/domain/alarm/alarm.type';

interface AudienceResolved {
  readonly kind: 'resolved';
  readonly audience: AlarmAudience;
}

type AudienceResolution = AudienceResolved | AlarmRejected;

export class Alarm {
  static readonly URGENT_RECIPIENT_RANGE: Readonly<CountRange> = { min: 1, max: 100 };

  private constructor(private readonly props: AlarmSnapshot) {}

  static create(id: AlarmId, draft: Readonly<AlarmDraft>, now: Readonly<Date>): AlarmCreation {
    const { title, body } = draft;
    if (title.trim().length === 0) {
      return Alarm.reject({ code: 'EMPTY_TITLE' });
    }
    if (body.trim().length === 0) {
      return Alarm.reject({ code: 'EMPTY_BODY' });
    }
    const resolution: AudienceResolution = Alarm.resolveAudience(draft);
    if (resolution.kind === 'rejected') {
      return resolution;
    }
    return {
      kind: 'created',
      alarm: new Alarm({
        id,
        title,
        body,
        ...resolution.audience,
        state: { status: 'DRAFT' },
        createdAt: Alarm.copyDate(now),
      }),
    };
  }

  snapshot(): AlarmSnapshot {
    const { id, title, body, state, createdAt }: AlarmSnapshot = this.props;
    return {
      id,
      title,
      body,
      ...Alarm.copyAudience(this.props),
      state: Alarm.copyState(state),
      createdAt: Alarm.copyDate(createdAt),
    };
  }

  private static resolveAudience({ kind, recipientIds }: Readonly<AlarmDraft>): AudienceResolution {
    if (kind === 'BULK') {
      if (recipientIds.length > 0) {
        return Alarm.reject({ code: 'BULK_RECIPIENTS_NOT_ALLOWED' });
      }
      return { kind: 'resolved', audience: { kind: 'BULK', target: { kind: 'ALL_USERS' } } };
    }
    const unique: ReadonlyArray<string> = [...new Set<string>(recipientIds)];
    const valid: RecipientId[] = [];
    for (const value of unique) {
      if (!AlarmPredicates.isRecipientId(value)) {
        return Alarm.reject({ code: 'INVALID_RECIPIENT_ID', value });
      }
      valid.push(value);
    }
    const { min, max }: Readonly<CountRange> = Alarm.URGENT_RECIPIENT_RANGE;
    if (valid.length < min || valid.length > max) {
      return Alarm.reject({
        code: 'URGENT_RECIPIENTS_OUT_OF_RANGE',
        count: valid.length,
        min,
        max,
      });
    }
    return {
      kind: 'resolved',
      audience: { kind: 'URGENT', target: { kind: 'EXPLICIT', recipientIds: valid } },
    };
  }

  private static copyAudience(audience: AlarmAudience): AlarmAudience {
    if (audience.kind === 'BULK') {
      return { kind: 'BULK', target: { kind: 'ALL_USERS' } };
    }
    return {
      kind: 'URGENT',
      target: { kind: 'EXPLICIT', recipientIds: [...audience.target.recipientIds] },
    };
  }

  private static copyState(state: AlarmState): AlarmState {
    switch (state.status) {
      case 'DRAFT':
        return { status: 'DRAFT' };
      case 'DISPATCHING':
        return { status: 'DISPATCHING', dispatchedAt: Alarm.copyDate(state.dispatchedAt) };
      case 'COMPLETED':
        return {
          status: 'COMPLETED',
          dispatchedAt: Alarm.copyDate(state.dispatchedAt),
          completedAt: Alarm.copyDate(state.completedAt),
        };
      case 'CANCELLED':
        break;
    }
    return {
      status: 'CANCELLED',
      cancelledAt: Alarm.copyDate(state.cancelledAt),
      dispatch:
        state.dispatch.kind === 'NEVER'
          ? { kind: 'NEVER' }
          : { kind: 'STARTED', at: Alarm.copyDate(state.dispatch.at) },
    };
  }

  private static copyDate(date: Readonly<Date>): Date {
    return new Date(date.getTime());
  }

  private static reject(error: AlarmValidationError): AlarmRejected {
    return { kind: 'rejected', error };
  }
}
