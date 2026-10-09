import { Injectable } from '@nestjs/common';
import { ClockPort } from '@/modules/notification/application/port/driven/for-telling-time/clock.port';

@Injectable()
export class SystemClockAdapter implements ClockPort {
  now(): Date {
    return new Date();
  }
}
