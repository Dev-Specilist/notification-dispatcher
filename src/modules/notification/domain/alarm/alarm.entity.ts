import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import {
  AlarmAction,
  AlarmAudience,
  AlarmCompletion,
  AlarmConflicted,
  AlarmCreation,
  AlarmDraft,
  AlarmId,
  AlarmRejected,
  AlarmSnapshot,
  AlarmState,
  AlarmTransition,
  AlarmValidationError,
  CancellableState,
  CompletionEvidence,
  CountRange,
  DispatchRecord,
  RecipientId,
} from '@/modules/notification/domain/alarm/alarm.type';

interface AudienceResolved {
  readonly kind: 'resolved';
  readonly audience: AlarmAudience;
}

type AudienceResolution = AudienceResolved | AlarmRejected;

export class Alarm {
  private static readonly URGENT_RECIPIENT_RANGE: Readonly<CountRange> = Object.freeze({
    min: 1,
    max: 100,
  });

  private constructor(private readonly props: AlarmSnapshot) {}

  static create(id: AlarmId, draft: Readonly<AlarmDraft>, now: Readonly<Date>): AlarmCreation {
    const { title, body }: Readonly<AlarmDraft> = draft;
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

  static reconstitute(snapshot: Readonly<AlarmSnapshot>): Alarm {
    const { id, title, body, state, createdAt }: Readonly<AlarmSnapshot> = snapshot;
    return new Alarm({
      id,
      title,
      body,
      ...Alarm.copyAudience(snapshot),
      state: Alarm.copyState(state),
      createdAt: Alarm.copyDate(createdAt),
    });
  }

  startDispatch(now: Readonly<Date>): AlarmTransition {
    const { state }: AlarmSnapshot = this.props;
    if (state.status !== 'DRAFT') {
      return Alarm.conflict(state, 'dispatch');
    }
    return this.transitionTo({ status: 'DISPATCHING', dispatchedAt: Alarm.copyDate(now) });
  }

  cancel(now: Readonly<Date>): AlarmTransition {
    const { state }: AlarmSnapshot = this.props;
    if (!Alarm.isCancellable(state)) {
      return Alarm.conflict(state, 'cancel');
    }
    return this.transitionTo({
      status: 'CANCELLED',
      cancelledAt: Alarm.copyDate(now),
      dispatch: Alarm.dispatchRecordOf(state),
    });
  }

  complete(
    { expansionCompleted, unsettledDeliveries }: Readonly<CompletionEvidence>,
    now: Readonly<Date>,
  ): AlarmCompletion {
    const { state }: AlarmSnapshot = this.props;
    if (state.status !== 'DISPATCHING') {
      return Alarm.conflict(state, 'complete');
    }
    if (!expansionCompleted || unsettledDeliveries !== 0) {
      return { kind: 'unchanged', alarm: this };
    }
    return this.transitionTo({
      status: 'COMPLETED',
      dispatchedAt: Alarm.copyDate(state.dispatchedAt),
      completedAt: Alarm.copyDate(now),
    });
  }

  isCancelled(): boolean {
    return this.props.state.status === 'CANCELLED';
  }

  requiresExpansion(): boolean {
    return this.props.kind === 'BULK';
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

  private transitionTo(state: AlarmState): AlarmTransition {
    return { kind: 'transitioned', alarm: new Alarm({ ...this.snapshot(), state }) };
  }

  private static conflict({ status }: Readonly<AlarmState>, action: AlarmAction): AlarmConflicted {
    return { kind: 'conflict', error: { code: 'ALARM_STATE_CONFLICT', status, action } };
  }

  private static resolveAudience({ kind, recipientIds }: Readonly<AlarmDraft>): AudienceResolution {
    if (kind === 'BULK') {
      if (recipientIds.length > 0) {
        return Alarm.reject({ code: 'BULK_RECIPIENTS_NOT_ALLOWED' });
      }
      return { kind: 'resolved', audience: { kind: 'BULK', target: { kind: 'ALL_USERS' } } };
    }
    const distinctRecipientIds: ReadonlyArray<string> = [...new Set<string>(recipientIds)];
    const validRecipientIds: RecipientId[] = [];
    for (const rawRecipientId of distinctRecipientIds) {
      if (!AlarmPredicates.isRecipientId(rawRecipientId)) {
        return Alarm.reject({ code: 'INVALID_RECIPIENT_ID', value: rawRecipientId });
      }
      validRecipientIds.push(rawRecipientId);
    }
    const { min, max }: Readonly<CountRange> = Alarm.URGENT_RECIPIENT_RANGE;
    if (validRecipientIds.length < min || validRecipientIds.length > max) {
      return Alarm.reject({
        code: 'URGENT_RECIPIENTS_OUT_OF_RANGE',
        count: validRecipientIds.length,
        min,
        max,
      });
    }
    return {
      kind: 'resolved',
      audience: { kind: 'URGENT', target: { kind: 'EXPLICIT', recipientIds: validRecipientIds } },
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
      dispatch: Alarm.copyDispatchRecord(state.dispatch),
    };
  }

  private static isCancellable(state: AlarmState): state is CancellableState {
    return state.status === 'DRAFT' || state.status === 'DISPATCHING';
  }

  private static dispatchRecordOf(state: CancellableState): DispatchRecord {
    return state.status === 'DRAFT'
      ? { kind: 'NEVER' }
      : { kind: 'STARTED', at: Alarm.copyDate(state.dispatchedAt) };
  }

  private static copyDispatchRecord(record: DispatchRecord): DispatchRecord {
    return record.kind === 'NEVER'
      ? { kind: 'NEVER' }
      : { kind: 'STARTED', at: Alarm.copyDate(record.at) };
  }

  private static copyDate(date: Readonly<Date>): Date {
    return new Date(date.getTime());
  }

  private static reject(error: AlarmValidationError): AlarmRejected {
    return { kind: 'rejected', error };
  }
}
