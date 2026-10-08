export interface ExpansionFinished {
  readonly kind: 'completed';
}

export interface ExpansionJobNotFound {
  readonly kind: 'not-found';
  readonly alarmId: string;
}

export interface ExpansionSuperseded {
  readonly kind: 'superseded';
}

export interface ExpansionCancelled {
  readonly kind: 'cancelled';
}

export type ExpansionResult =
  ExpansionFinished | ExpansionJobNotFound | ExpansionSuperseded | ExpansionCancelled;
