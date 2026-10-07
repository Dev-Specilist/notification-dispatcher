import { PageSize } from '@/modules/notification/application/port/alarm-repository.type';

export class AlarmRepositoryPredicates {
  static isPageSize(value: number): value is PageSize {
    return Number.isSafeInteger(value) && value > 0;
  }
}
