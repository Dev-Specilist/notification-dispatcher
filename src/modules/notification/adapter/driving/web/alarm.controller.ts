import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiAcceptedResponse, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CancelAlarmResult } from '@/modules/notification/application/port/driving/for-managing-alarms/cancel-alarm.type';
import { CancelAlarmUseCase } from '@/modules/notification/application/port/driving/for-managing-alarms/cancel-alarm.use-case';
import { CreateAlarmResult } from '@/modules/notification/application/port/driving/for-managing-alarms/create-alarm.type';
import { CreateAlarmUseCase } from '@/modules/notification/application/port/driving/for-managing-alarms/create-alarm.use-case';
import { GetAlarmResult } from '@/modules/notification/application/port/driving/for-managing-alarms/get-alarm.type';
import { GetAlarmUseCase } from '@/modules/notification/application/port/driving/for-managing-alarms/get-alarm.use-case';
import {
  ListAlarmsQuery,
  ListAlarmsResult,
} from '@/modules/notification/application/port/driving/for-managing-alarms/list-alarms.type';
import { ListAlarmsUseCase } from '@/modules/notification/application/port/driving/for-managing-alarms/list-alarms.use-case';
import { StartDispatchResult } from '@/modules/notification/application/port/driving/for-managing-alarms/start-dispatch.type';
import { StartDispatchUseCase } from '@/modules/notification/application/port/driving/for-managing-alarms/start-dispatch.use-case';
import { alarmIdParamSchema } from '@/modules/notification/adapter/driving/web/alarm-id-param.schema';
import {
  AlarmDetailResponse,
  AlarmListResponse,
  AlarmResponse,
} from '@/modules/notification/adapter/driving/web/alarm-response.type';
import { AlarmPresenter } from '@/modules/notification/adapter/driving/web/alarm.presenter';
import {
  alarmDetailResponseSchema,
  alarmListResponseSchema,
  alarmResponseSchema,
} from '@/modules/notification/adapter/driving/web/alarm-response.schema';
import { createAlarmSchema } from '@/modules/notification/adapter/driving/web/create-alarm.schema';
import { listAlarmsQuerySchema } from '@/modules/notification/adapter/driving/web/list-alarms.schema';
import { ApiProblemResponse } from '@/shared/http/api-problem-response.decorator';
import { RequestValidationException } from '@/shared/http/request-validation.exception';

type CreateAlarmBody = z.output<typeof createAlarmSchema>;

type AlarmIdParam = z.output<typeof alarmIdParamSchema>;

@ApiTags('alarms')
@Controller('alarms')
export class AlarmController {
  constructor(
    private readonly createAlarm: CreateAlarmUseCase,
    private readonly getAlarm: GetAlarmUseCase,
    private readonly startDispatch: StartDispatchUseCase,
    private readonly cancelAlarm: CancelAlarmUseCase,
    private readonly listAlarms: ListAlarmsUseCase,
  ) {}

  @Post()
  @ApiCreatedResponse({ description: '만든 DRAFT 알림', standardSchema: alarmResponseSchema })
  @ApiProblemResponse.of(
    HttpStatus.BAD_REQUEST,
    'VALIDATION_FAILED: 요청 본문 검증 또는 도메인 규칙 위반',
  )
  async create(@Body({ schema: createAlarmSchema }) body: CreateAlarmBody): Promise<AlarmResponse> {
    const result: CreateAlarmResult = await this.createAlarm.execute(body);
    if (result.kind === 'rejected') {
      throw new RequestValidationException([AlarmPresenter.violationOf(result.error)]);
    }
    return AlarmPresenter.toResponse(result.alarm);
  }

  @Get()
  @ApiOkResponse({
    description: '생성 역순 알림 목록과 다음 페이지 cursor',
    standardSchema: alarmListResponseSchema,
  })
  @ApiProblemResponse.of(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED: 잘못된 필터·cursor·limit')
  async list(
    @Query({ schema: listAlarmsQuerySchema }) query: ListAlarmsQuery,
  ): Promise<AlarmListResponse> {
    const result: ListAlarmsResult = await this.listAlarms.execute(query);
    if (result.kind === 'rejected') {
      throw new RequestValidationException([AlarmPresenter.listViolationOf(result.error)]);
    }
    return AlarmPresenter.toListResponse(result);
  }

  @Get(':id')
  @ApiOkResponse({
    description: '알림과 발송 건(Delivery) 상태별 집계',
    standardSchema: alarmDetailResponseSchema,
  })
  @ApiProblemResponse.of(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED: uuid가 아닌 id')
  @ApiProblemResponse.of(HttpStatus.NOT_FOUND, 'ALARM_NOT_FOUND')
  async findOne(
    @Param({ schema: alarmIdParamSchema }) { id: alarmId }: AlarmIdParam,
  ): Promise<AlarmDetailResponse> {
    const result: GetAlarmResult = await this.getAlarm.execute({ alarmId });
    if (result.kind === 'not-found') {
      throw AlarmPresenter.problemOf(result.error);
    }
    return AlarmPresenter.toDetailResponse(result.alarm, result.deliveries);
  }

  @Post(':id/dispatch')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiAcceptedResponse({
    description: '발송을 시작한 DISPATCHING 알림',
    standardSchema: alarmResponseSchema,
  })
  @ApiProblemResponse.of(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED: uuid가 아닌 id')
  @ApiProblemResponse.of(HttpStatus.NOT_FOUND, 'ALARM_NOT_FOUND')
  @ApiProblemResponse.of(HttpStatus.CONFLICT, 'ALARM_STATE_CONFLICT: DRAFT가 아닌 알림')
  async dispatch(
    @Param({ schema: alarmIdParamSchema }) { id: alarmId }: AlarmIdParam,
  ): Promise<AlarmResponse> {
    const result: StartDispatchResult = await this.startDispatch.execute({ alarmId });
    if (result.kind !== 'dispatched') {
      throw AlarmPresenter.problemOf(result.error);
    }
    return AlarmPresenter.toResponse(result.alarm);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: '취소한 CANCELLED 알림', standardSchema: alarmResponseSchema })
  @ApiProblemResponse.of(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED: uuid가 아닌 id')
  @ApiProblemResponse.of(HttpStatus.NOT_FOUND, 'ALARM_NOT_FOUND')
  @ApiProblemResponse.of(HttpStatus.CONFLICT, 'ALARM_STATE_CONFLICT: 이미 종결된 알림')
  async cancel(
    @Param({ schema: alarmIdParamSchema }) { id: alarmId }: AlarmIdParam,
  ): Promise<AlarmResponse> {
    const result: CancelAlarmResult = await this.cancelAlarm.execute({ alarmId });
    if (result.kind !== 'cancelled') {
      throw AlarmPresenter.problemOf(result.error);
    }
    return AlarmPresenter.toResponse(result.alarm);
  }
}
