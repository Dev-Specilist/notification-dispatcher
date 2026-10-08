export type ExpansionPageStepName =
  'continued' | 'completed' | 'cancelled' | 'superseded' | 'not-found';

export interface NothingToExpand {
  readonly kind: 'idle';
}

export interface ExpansionPageProcessed {
  readonly kind: 'expanded';
  readonly alarmId: string;
  readonly step: ExpansionPageStepName;
}

export type ExpansionPageAttempt = NothingToExpand | ExpansionPageProcessed;
