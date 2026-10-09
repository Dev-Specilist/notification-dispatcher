import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RecipientId } from '@/modules/notification/domain/alarm/alarm.type';
import {
  FollowingPage,
  NextPage,
  PageCursor,
  RecipientPage,
} from '@/modules/notification/application/port/driven/for-fetching-recipients/recipient-directory.type';
import { MockApiPredicates } from '@/modules/notification/adapter/driven/mock-api/mock-api.predicate';
import {
  RecipientDirectorySettings,
  RequestTimeoutMs,
  UserPageLimit,
} from '@/modules/notification/adapter/driven/mock-api/mock-api.type';
import { MockRecipientDirectoryAdapter } from '@/modules/notification/adapter/driven/mock-api/recipient/mock-recipient-directory.adapter';
import { MockApiContainer } from '@/modules/notification/testing/mock-api.container';
import { StubHttpServer } from '@/modules/notification/testing/stub-http.server';
import { KindAssertion } from '@/shared/testing/kind.assertion';

type FailingResponseCase = Readonly<[string, number, string]>;

interface DirectoryReading {
  readonly recipientIds: ReadonlyArray<RecipientId>;
  readonly pageCount: number;
  readonly last: FollowingPage;
}

const USER_COUNT: number = 250;

const REQUEST_TIMEOUT_MS: number = 5_000;

const SHORT_TIMEOUT_MS: number = 300;

const requestTimeoutMs = (value: number): RequestTimeoutMs => {
  if (!MockApiPredicates.isRequestTimeoutMs(value)) {
    throw new Error(`test fixture ${value} is not a valid RequestTimeoutMs`);
  }
  return value;
};

const pageLimit = (value: number): UserPageLimit => {
  if (!MockApiPredicates.isUserPageLimit(value)) {
    throw new Error(`test fixture ${value} is not a valid UserPageLimit`);
  }
  return value;
};

const settingsFor = (
  baseUrl: URL,
  limit: number,
  timeoutMs: number,
): RecipientDirectorySettings => ({
  baseUrl,
  pageLimit: pageLimit(limit),
  requestTimeoutMs: requestTimeoutMs(timeoutMs),
});

const readToEnd = async (
  directory: MockRecipientDirectoryAdapter,
  cursor: PageCursor,
  readSoFar: DirectoryReading,
): Promise<DirectoryReading> => {
  const { recipientIds, next }: RecipientPage = await directory.fetchPage(cursor);
  const reading: DirectoryReading = {
    recipientIds: [...readSoFar.recipientIds, ...recipientIds],
    pageCount: readSoFar.pageCount + 1,
    last: next,
  };
  return next.kind === 'end' ? reading : readToEnd(directory, next, reading);
};

const nextCursorOf = ({ next }: Readonly<RecipientPage>): NextPage => {
  KindAssertion.assertKind(next, 'next');
  return next;
};

const fetchFirstPageFrom = async (stub: StubHttpServer): Promise<RecipientPage> => {
  try {
    return await new MockRecipientDirectoryAdapter(
      settingsFor(stub.baseUrl, 100, REQUEST_TIMEOUT_MS),
    ).fetchPage({ kind: 'first' });
  } finally {
    await stub.close();
  }
};

describe('MockRecipientDirectoryAdapter', () => {
  let mock: MockApiContainer;

  beforeAll(async (): Promise<void> => {
    mock = await MockApiContainer.start({ USER_COUNT: String(USER_COUNT) });
  });

  afterAll(async (): Promise<void> => {
    await mock.stop();
  });

  it("EXT-01 mock 사용자 API / cursor로 끝까지 읽는다 → USER_COUNT명이 중복 없이 나오고 마지막 페이지는 { kind: 'end' }로 표현된다", async (): Promise<void> => {
    const directory: MockRecipientDirectoryAdapter = new MockRecipientDirectoryAdapter(
      settingsFor(mock.baseUrl, 100, REQUEST_TIMEOUT_MS),
    );

    const reading: DirectoryReading = await readToEnd(
      directory,
      { kind: 'first' },
      { recipientIds: [], pageCount: 0, last: { kind: 'end' } },
    );

    expect(reading.recipientIds).toHaveLength(USER_COUNT);
    expect(new Set(reading.recipientIds).size).toBe(USER_COUNT);
    expect(reading.pageCount).toBe(3);
    expect(reading.last).toEqual({ kind: 'end' });
  });

  it('EXT-01 다음 cursor가 있으면 next 페이지로, 그 cursor로 이어 읽으면 다음 사용자부터 나온다', async (): Promise<void> => {
    const directory: MockRecipientDirectoryAdapter = new MockRecipientDirectoryAdapter(
      settingsFor(mock.baseUrl, 2, REQUEST_TIMEOUT_MS),
    );

    const firstPage: RecipientPage = await directory.fetchPage({ kind: 'first' });
    const secondPage: RecipientPage = await directory.fetchPage(nextCursorOf(firstPage));

    expect(firstPage.recipientIds).toEqual(['u_000001', 'u_000002']);
    expect(firstPage.next).toMatchObject({ kind: 'next' });
    expect(secondPage.recipientIds).toEqual(['u_000003', 'u_000004']);
  });

  it.each<FailingResponseCase>([
    ['500 오류', 500, '{"code":"INTERNAL_ERROR","message":"boom"}'],
    ['본문은 정상 페이지 형식인 503 오류', 503, '{"users":[],"nextCursor":"Mw"}'],
    ['잘못된 cursor로 400', 400, '{"code":"INVALID_REQUEST","message":"invalid cursor"}'],
    ['users 필드가 없는 200', 200, '{"items":[],"nextCursor":"Mw"}'],
    ['nextCursor 필드가 없는 200', 200, '{"users":[]}'],
    [
      '사용자 id가 비어 있는 200',
      200,
      '{"users":[{"id":"","name":"a","phone":"b"}],"nextCursor":"Mw"}',
    ],
    ['JSON이 아닌 200', 200, 'not json'],
  ])(
    'EXT-01 사용자 API가 %s를 주면 빈 페이지로 끝내지 않고 실패로 알린다 (수신자 누락 방지, 확장은 마지막 커밋 cursor부터 재시도)',
    async (_label: string, status: number, body: string): Promise<void> => {
      const stub: StubHttpServer = await StubHttpServer.respondingWith({
        status,
        headers: { 'content-type': 'application/json' },
        body,
      });

      await expect(fetchFirstPageFrom(stub)).rejects.toThrow('recipient directory');
    },
  );

  it('EXT-01 사용자 API 응답이 제한 시간 안에 끝나지 않으면 실패로 알린다', async (): Promise<void> => {
    const stub: StubHttpServer = await StubHttpServer.streamingEndlessly(200);
    try {
      const directory: MockRecipientDirectoryAdapter = new MockRecipientDirectoryAdapter(
        settingsFor(stub.baseUrl, 100, SHORT_TIMEOUT_MS),
      );

      await expect(directory.fetchPage({ kind: 'first' })).rejects.toThrow('recipient directory');
    } finally {
      await stub.close();
    }
  });

  it('EXT-01 사용자 API에 연결할 수 없으면 실패로 알린다', async (): Promise<void> => {
    const stub: StubHttpServer = await StubHttpServer.respondingWith({
      status: 200,
      headers: {},
      body: '',
    });
    await stub.close();
    const directory: MockRecipientDirectoryAdapter = new MockRecipientDirectoryAdapter(
      settingsFor(stub.baseUrl, 100, REQUEST_TIMEOUT_MS),
    );

    await expect(directory.fetchPage({ kind: 'first' })).rejects.toThrow('recipient directory');
  });
});
