import { afterAll, beforeAll, describe, it } from 'vitest';
import { Controller, Get, INestApplication, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { request, spec } from 'pactum';
import { ApiStandardModule } from '@/shared/http/api-standard.module';
import { ProblemDetails } from '@/shared/http/problem-details.type';

@Controller('samples')
class SampleController {
  @Get('missing')
  missing(): never {
    throw new NotFoundException('sample 42 not found');
  }

  @Get('boom')
  boom(): never {
    throw new Error('database password leaked in message');
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

const INTERNAL_ERROR: ProblemDetails = {
  type: 'about:blank',
  title: 'Internal Server Error',
  status: 500,
  detail: '서버 내부 오류가 발생했습니다',
  instance: '/samples/boom',
  code: 'INTERNAL_SERVER_ERROR',
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
});
