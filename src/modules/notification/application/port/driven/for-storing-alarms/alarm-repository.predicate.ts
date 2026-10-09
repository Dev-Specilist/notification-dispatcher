import { PageSize } from '@/modules/notification/application/port/driven/for-storing-alarms/alarm-repository.type';

export class AlarmRepositoryPredicates {
  static isPageSize(value: number): value is PageSize {
    return Number.isSafeInteger(value) && value > 0;
  }
}
