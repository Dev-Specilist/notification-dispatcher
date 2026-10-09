export interface AlarmCompleted {
  readonly kind: 'completed';
}

export interface AlarmNotYetSettled {
  readonly kind: 'not-yet';
}

export interface AlarmCompletionSkipped {
  readonly kind: 'skipped';
  readonly reason: 'missing' | 'not-dispatching';
}

export type AlarmCompletionCheck = AlarmCompleted | AlarmNotYetSettled | AlarmCompletionSkipped;
