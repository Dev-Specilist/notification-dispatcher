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

export interface ExpansionContinues {
  readonly kind: 'continued';
}

export type ExpansionResult =
  ExpansionFinished | ExpansionJobNotFound | ExpansionSuperseded | ExpansionCancelled;

export type ExpansionStep = ExpansionResult | ExpansionContinues;
