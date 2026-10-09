export interface SettledAlarmsSwept {
  readonly kind: 'swept';
  readonly checkedAlarmCount: number;
  readonly completedAlarmCount: number;
}
