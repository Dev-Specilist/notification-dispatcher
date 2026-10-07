import { afterAll, beforeAll, describe, it } from 'vitest';
import {
  Body,
  Controller,
  Get,
  INestApplication,
  InternalServerErrorException,
  NotFoundException,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { request, spec } from 'pactum';
import { z } from 'zod';
import { ApiStandardModule } from '@/shared/http/api-standard.module';
import { ProblemDetails } from '@/shared/http/problem-details.type';

const createSampleSchema = z.object({
  title: z.string().min(1),
  count: z.number().int().positive(),
});

type CreateSample = z.infer<typeof createSampleSchema>;

@Controller('samples')
class SampleController {
  @Post()
  create(@Body({ schema: createSampleSchema }) body: CreateSample): CreateSample {
    return body;
  }

  @Get('missing')
  missing(): never {
    throw new NotFoundException('sample 42 not found');
  }

  @Get('boom')
  boom(): never {
    throw new Error('database password leaked in message');
  }

  @Get('boom-http')
  boomHttp(): never {
    throw new InternalServerErrorException('internal diagnostic leaked in message');
  }

  @Get('unavailable')
  unavailable(): never {
    throw new ServiceUnavailableException('db host 10.0.0.3 is down');
  }
}

const PROBLEM_JSON: string = 'application/problem+json; charset=utf-8';

const NOT_FOUND: ProblemDetails = {
  type: 'about:blank',
  title: 'Not Found',
  status: 404,
  detail: 'sample 42 not found',
  instance: '/samples/missing',
  code: 'NOT_FOUND',
  errors: [],
};

const ROUTE_NOT_FOUND: ProblemDetails = {
  type: 'about:blank',
  title: 'Not Found',
  status: 404,
  detail: 'Cannot GET /nowhere',
  instance: '/nowhere',
  code: 'NOT_FOUND',
  errors: [],
};

const VALIDATION_FAILED: ProblemDetails = {
  type: 'about:blank',
  title: 'Bad Request',
  status: 400,
  detail: '요청 값이 올바르지 않습니다',
  instance: '/samples',
  code: 'VALIDATION_FAILED',
  errors: [
    { field: 'title', message: 'Too small: expected string to have >=1 characters' },
    { field: 'count', message: 'Too small: expected number to be >0' },
  ],
};

const INTERNAL_ERROR: ProblemDetails = {
  type: 'about:blank',
  title: 'Internal Server Error',
  status: 500,
  detail: '서버 내부 오류가 발생했습니다',
  instance: '/samples/boom',
  code: 'INTERNAL_SERVER_ERROR',
  errors: [],
};

const INTERNAL_HTTP_ERROR: ProblemDetails = { ...INTERNAL_ERROR, instance: '/samples/boom-http' };

const SERVICE_UNAVAILABLE: ProblemDetails = {
  type: 'about:blank',
  title: 'Service Unavailable',
  status: 503,
  detail: '서버 내부 오류가 발생했습니다',
  instance: '/samples/unavailable',
  code: 'SERVICE_UNAVAILABLE',
  errors: [],
};

describe('RFC 9457 Problem Details 응답', () => {
  let app: INestApplication;

  beforeAll(async (): Promise<void> => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [ApiStandardModule],
      controllers: [SampleController],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    request.setBaseUrl(await app.getUrl());
  });

  afterAll(async (): Promise<void> => {
    await app.close();
  });

  it('검증을 통과한 요청 본문은 스키마 결과 그대로 컨트롤러에 전달된다', async (): Promise<void> => {
    await spec()
      .post('/samples')
      .withJson({ title: '추석 이벤트', count: 3, extra: 'dropped' })
      .expectStatus(201)
      .expectJson({ title: '추석 이벤트', count: 3 });
  });

  it('요청 본문 검증에 실패하면 400과 필드별 오류를 반환한다', async (): Promise<void> => {
    await spec()
      .post('/samples')
      .withJson({ title: '', count: 0 })
      .expectStatus(400)
      .expectHeader('content-type', PROBLEM_JSON)
      .expectJson(VALIDATION_FAILED);
  });

  it('HttpException은 상태 코드와 메시지를 유지한 Problem Details로 반환한다', async (): Promise<void> => {
    await spec()
      .get('/samples/missing')
      .expectStatus(404)
      .expectHeader('content-type', PROBLEM_JSON)
      .expectJson(NOT_FOUND);
  });

  it('존재하지 않는 경로도 Problem Details로 반환한다', async (): Promise<void> => {
    await spec().get('/nowhere').expectStatus(404).expectJson(ROUTE_NOT_FOUND);
  });

  it('예상하지 못한 오류는 내부 메시지를 숨기고 500을 반환한다', async (): Promise<void> => {
    await spec()
      .get('/samples/boom')
      .expectStatus(500)
      .expectHeader('content-type', PROBLEM_JSON)
      .expectJson(INTERNAL_ERROR);
  });

  it('5xx HttpException도 내부 메시지를 숨기고 500을 반환한다', async (): Promise<void> => {
    await spec()
      .get('/samples/boom-http')
      .expectStatus(500)
      .expectHeader('content-type', PROBLEM_JSON)
      .expectJson(INTERNAL_HTTP_ERROR);
  });

  it('5xx HttpException은 상태 코드는 유지하고 내부 메시지는 숨긴다', async (): Promise<void> => {
    await spec()
      .get('/samples/unavailable')
      .expectStatus(503)
      .expectHeader('content-type', PROBLEM_JSON)
      .expectJson(SERVICE_UNAVAILABLE);
  });
});
