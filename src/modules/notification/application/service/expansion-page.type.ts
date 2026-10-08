import { ExpansionResult } from '@/modules/notification/application/port/in/expand-recipients.type';

export interface ExpansionContinues {
  readonly kind: 'continued';
}

export type ExpansionStep = ExpansionResult | ExpansionContinues;
