import { AlarmId } from '@/modules/notification/domain/alarm/alarm.type';

export interface ExpansionFinished {
  readonly kind: 'completed';
}

export interface ExpansionJobNotFound {
  readonly kind: 'not-found';
  readonly alarmId: AlarmId;
}

export interface ExpansionSuperseded {
  readonly kind: 'superseded';
}

export type ExpansionResult = ExpansionFinished | ExpansionJobNotFound | ExpansionSuperseded;
