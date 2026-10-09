export interface CompletionScanPosition {
  readonly createdAt: Date;
  readonly alarmId: string;
}

export interface ScanFromNewest {
  readonly kind: 'newest';
}

export interface ScanAfterPosition {
  readonly kind: 'after';
  readonly position: CompletionScanPosition;
}

export type CompletionScanStart = ScanFromNewest | ScanAfterPosition;

export interface LastScanPage {
  readonly kind: 'last';
}

export interface MoreToScan {
  readonly kind: 'more';
  readonly after: CompletionScanPosition;
}

export type CompletionScanNext = LastScanPage | MoreToScan;

export interface CompleteSettledAlarmsCommand {
  readonly start: CompletionScanStart;
}

export interface AlarmCompletionFailure {
  readonly alarmId: string;
  readonly reason: string;
}

export interface SettledAlarmsPageChecked {
  readonly kind: 'checked';
  readonly checkedAlarmCount: number;
  readonly completedAlarmCount: number;
  readonly failures: ReadonlyArray<AlarmCompletionFailure>;
  readonly next: CompletionScanNext;
}
