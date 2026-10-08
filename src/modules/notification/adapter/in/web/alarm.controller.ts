import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { AlarmResult } from '@/modules/notification/application/port/in/alarm-result.type';
import { CreateAlarmResult } from '@/modules/notification/application/port/in/create-alarm.type';
import { CreateAlarmUseCase } from '@/modules/notification/application/port/in/create-alarm.use-case';
import { GetAlarmUseCase } from '@/modules/notification/application/port/in/get-alarm.use-case';
import { alarmIdParamSchema } from '@/modules/notification/adapter/in/web/alarm-id-param.schema';
import {
  AlarmDetailResponse,
  AlarmResponse,
} from '@/modules/notification/adapter/in/web/alarm-response.type';
import { AlarmPresenter } from '@/modules/notification/adapter/in/web/alarm.presenter';
import { createAlarmSchema } from '@/modules/notification/adapter/in/web/create-alarm.schema';
import { RequestValidationException } from '@/shared/http/request-validation.exception';

type CreateAlarmBody = z.output<typeof createAlarmSchema>;

type AlarmIdParam = z.output<typeof alarmIdParamSchema>;

@Controller('alarms')
export class AlarmController {
  constructor(
    private readonly createAlarm: CreateAlarmUseCase,
    private readonly getAlarm: GetAlarmUseCase,
  ) {}

  @Post()
  async create(@Body({ schema: createAlarmSchema }) body: CreateAlarmBody): Promise<AlarmResponse> {
    const result: CreateAlarmResult = await this.createAlarm.execute(body);
    if (result.kind === 'rejected') {
      throw new RequestValidationException([AlarmPresenter.violationOf(result.error)]);
    }
    return AlarmPresenter.toResponse(result.alarm);
  }

  @Get(':id')
  async findOne(
    @Param({ schema: alarmIdParamSchema }) { id: alarmId }: AlarmIdParam,
  ): Promise<AlarmDetailResponse> {
    const result: AlarmResult = await this.getAlarm.execute({ alarmId });
    if (result.kind === 'not-found') {
      throw AlarmPresenter.problemOf(result.error);
    }
    return AlarmPresenter.toDetailResponse(result.alarm, result.deliveries);
  }
}
