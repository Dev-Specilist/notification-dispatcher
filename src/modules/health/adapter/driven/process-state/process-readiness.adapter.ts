import { Injectable } from '@nestjs/common';
import { ReadinessPort } from '@/modules/health/application/port/driven/for-tracking-readiness/readiness.port';

@Injectable()
export class ProcessReadinessAdapter implements ReadinessPort {
  private acceptingTraffic: boolean = true;

  isAcceptingTraffic(): boolean {
    return this.acceptingTraffic;
  }

  stopAcceptingTraffic(): void {
    this.acceptingTraffic = false;
  }
}
