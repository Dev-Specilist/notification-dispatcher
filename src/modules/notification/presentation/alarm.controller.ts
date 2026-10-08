import { Body, Controller, Post } from '@nestjs/common';
import { z } from 'zod';
import { CreateAlarmResult } from '@/modules/notification/application/port/in/create-alarm.type';
import { CreateAlarmUseCase } from '@/modules/notification/application/port/in/create-alarm.use-case';
import { AlarmResponse } from '@/modules/notification/presentation/alarm-response.type';
import { AlarmPresenter } from '@/modules/notification/presentation/alarm.presenter';
import { createAlarmSchema } from '@/modules/notification/presentation/create-alarm.schema';
import { RequestValidationException } from '@/shared/http/request-validation.exception';

type CreateAlarmBody = z.output<typeof createAlarmSchema>;

@Controller('alarms')
export class AlarmController {
  constructor(private readonly createAlarm: CreateAlarmUseCase) {}

  @Post()
  async create(@Body({ schema: createAlarmSchema }) body: CreateAlarmBody): Promise<AlarmResponse> {
    const result: CreateAlarmResult = await this.createAlarm.execute(body);
    if (result.kind === 'rejected') {
      throw new RequestValidationException([AlarmPresenter.violationOf(result.error)]);
    }
    return AlarmPresenter.toResponse(result.alarm);
  }
}
