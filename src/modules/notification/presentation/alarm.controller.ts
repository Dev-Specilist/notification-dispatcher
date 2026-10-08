import { Body, Controller, Post } from '@nestjs/common';
import { z } from 'zod';
import { AlarmCreation } from '@/modules/notification/domain/alarm/alarm.type';
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
    const creation: AlarmCreation = await this.createAlarm.execute(body);
    if (creation.kind === 'rejected') {
      throw new RequestValidationException([AlarmPresenter.violationOf(creation.error)]);
    }
    return AlarmPresenter.toResponse(creation.alarm);
  }
}
