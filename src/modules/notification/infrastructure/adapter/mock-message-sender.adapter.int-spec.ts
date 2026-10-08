import { randomUUID } from 'node:crypto';
import { scheduler } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import { DeliveryPredicates } from '@/modules/notification/domain/delivery/delivery.predicate';
import {
  OutgoingMessage,
  SendOutcome,
  SendOutcomeKind,
} from '@/modules/notification/application/port/out/message-sender.type';
import { MockApiPredicates } from '@/modules/notification/infrastructure/adapter/mock-api.predicate';
import { RequestTimeoutMs } from '@/modules/notification/infrastructure/adapter/mock-api.type';
import { MockMessageSenderAdapter } from '@/modules/notification/infrastructure/adapter/mock-message-sender.adapter';
import {
  MockApiContainer,
  MockApiEnvironment,
} from '@/modules/notification/infrastructure/testing/mock-api.container';
import { StubHttpServer } from '@/modules/notification/infrastructure/testing/stub-http.server';

type ConnectionState = 'released' | 'held';

type UnreadBodyCase = Readonly<[number, SendOutcomeKind]>;

type TransientStatusCase = Readonly<[number]>;

type RetryAfterHeaderCase = Readonly<[string, number, Readonly<Record<string, string>>]>;

const RELEASE_WAIT_MS: number = 1_000;

const REQUEST_TIMEOUT_MS: number = 5_000;

const SHORT_TIMEOUT_MS: number = 300;

const requestTimeoutMs = (value: number): RequestTimeoutMs => {
  if (!MockApiPredicates.isRequestTimeoutMs(value)) {
    throw new Error(`test fixture ${value} is not a valid RequestTimeoutMs`);
  }
  return value;
};

const BURST_RECIPIENTS: ReadonlyArray<string> = [
  'u_000001',
  'u_000002',
  'u_000003',
  'u_000004',
  'u_000005',
];

interface RateLimitedExpectation {
  readonly kind: 'rate-limited';
  readonly retryAfterMs: number;
}

const messageTo = (recipientId: string): OutgoingMessage => {
  const alarmId: string = randomUUID();
  const clientRef: string = randomUUID();
  if (
    !AlarmPredicates.isAlarmId(alarmId) ||
    !AlarmPredicates.isRecipientId(recipientId) ||
    !DeliveryPredicates.isDeliveryId(clientRef)
  ) {
    throw new Error('test fixture message is invalid');
  }
  return { alarmId, recipientId, body: '추석 이벤트 안내', clientRef };
};

const senderAt = (baseUrl: URL): MockMessageSenderAdapter =>
  new MockMessageSenderAdapter({ baseUrl, requestTimeoutMs: requestTimeoutMs(REQUEST_TIMEOUT_MS) });

const sendThrough = async (stub: StubHttpServer): Promise<SendOutcome> => {
  try {
    return await senderAt(stub.baseUrl).send(messageTo('u_000001'));
  } finally {
    await stub.close();
  }
};

describe('MockMessageSenderAdapter', () => {
  let deterministicMock: MockApiContainer;
  let blockingMock: MockApiContainer;
  let throttledMock: MockApiContainer;
  let failingMock: MockApiContainer;
  let stallingMock: MockApiContainer;

  const started: Array<MockApiContainer> = [];

  const startMock = async (
    overrides: Readonly<Partial<MockApiEnvironment>>,
  ): Promise<MockApiContainer> => {
    const mock: MockApiContainer = await MockApiContainer.start(overrides);
    started.push(mock);
    return mock;
  };

  beforeAll(async (): Promise<void> => {
    deterministicMock = await startMock({});
    blockingMock = await startMock({ BLOCKED_PERCENT: '100' });
    throttledMock = await startMock({ RATE_LIMIT: '1' });
    failingMock = await startMock({ ERROR_RATE: '1' });
    stallingMock = await startMock({ TIMEOUT_RATE: '1', TIMEOUT_MS: '5000' });
  });

  afterAll(async (): Promise<void> => {
    await Promise.all(started.map((mock: MockApiContainer): Promise<void> => mock.stop()));
  });

  it('EXT-02 mock 발송 API / 정상 발송 → Accepted(messageId) 결과가 나온다', async (): Promise<void> => {
    const sender: MockMessageSenderAdapter = senderAt(deterministicMock.baseUrl);

    const outcome: SendOutcome = await sender.send(messageTo('u_000001'));

    expect(outcome).toEqual({ kind: 'accepted', messageId: expect.stringMatching(/^m_\d+$/) });
  });

  it('EXT-03 수신 거부 사용자 / 발송 → PermanentFailure(RECIPIENT_BLOCKED) 결과가 나온다', async (): Promise<void> => {
    const sender: MockMessageSenderAdapter = senderAt(blockingMock.baseUrl);

    const outcome: SendOutcome = await sender.send(messageTo('u_000001'));

    expect(outcome).toEqual({ kind: 'permanent-failure', code: 'RECIPIENT_BLOCKED' });
  });

  it('EXT-03 존재하지 않는 사용자 / 발송 → PermanentFailure(UNKNOWN_RECIPIENT) 결과가 나온다', async (): Promise<void> => {
    const sender: MockMessageSenderAdapter = senderAt(deterministicMock.baseUrl);

    const outcome: SendOutcome = await sender.send(messageTo('u_999999'));

    expect(outcome).toEqual({ kind: 'permanent-failure', code: 'UNKNOWN_RECIPIENT' });
  });

  it('EXT-02 202인데 본문에 messageId가 없으면 발송됐을 수 있으므로 Indeterminate 결과가 나온다', async (): Promise<void> => {
    const stub: StubHttpServer = await StubHttpServer.respondingWith({
      status: 202,
      headers: { 'content-type': 'application/json' },
      body: '{"id":"m_1"}',
    });

    const outcome: SendOutcome = await sendThrough(stub);

    expect(outcome).toEqual({ kind: 'indeterminate' });
  });

  it('EXT-03 400인데 알 수 없는 code면 PermanentFailure(INVALID_REQUEST) 결과가 나온다', async (): Promise<void> => {
    const stub: StubHttpServer = await StubHttpServer.respondingWith({
      status: 400,
      headers: { 'content-type': 'text/plain' },
      body: 'bad request',
    });

    const outcome: SendOutcome = await sendThrough(stub);

    expect(outcome).toEqual({ kind: 'permanent-failure', code: 'INVALID_REQUEST' });
  });

  it.each<UnreadBodyCase>([
    [503, 'transient-failure'],
    [429, 'rate-limited'],
  ])(
    'EXT-02 본문을 읽지 않는 %s 응답이면 결과(%s)를 돌려주기 전에 본문을 취소해 연결을 놓아준다',
    async (status: number, expectedKind: SendOutcomeKind): Promise<void> => {
      const stub: StubHttpServer = await StubHttpServer.streamingEndlessly(status);
      try {
        const outcome: SendOutcome = await senderAt(stub.baseUrl).send(messageTo('u_000001'));
        const connection: ConnectionState = await Promise.race([
          stub.responseClosed.then((): ConnectionState => 'released'),
          scheduler.wait(RELEASE_WAIT_MS).then((): ConnectionState => 'held'),
        ]);

        expect(outcome.kind).toBe(expectedKind);
        expect(connection).toBe('released');
      } finally {
        await stub.close();
      }
    },
  );

  it('EXT-04 RATE_LIMIT을 낮춘 mock / 한도를 넘겨 발송 → RateLimited(retryAfterMs) 결과가 나온다', async (): Promise<void> => {
    const sender: MockMessageSenderAdapter = senderAt(throttledMock.baseUrl);

    const outcomes: ReadonlyArray<SendOutcome> = await Promise.all(
      BURST_RECIPIENTS.map((recipientId: string): Promise<SendOutcome> =>
        sender.send(messageTo(recipientId)),
      ),
    );
    const kinds: ReadonlyArray<SendOutcomeKind> = outcomes.map(
      ({ kind }: SendOutcome): SendOutcomeKind => kind,
    );
    const rateLimited: ReadonlyArray<SendOutcome> = outcomes.filter(
      ({ kind }: SendOutcome): boolean => kind === 'rate-limited',
    );

    expect(
      kinds.every(
        (kind: SendOutcomeKind): boolean => kind === 'accepted' || kind === 'rate-limited',
      ),
    ).toBe(true);
    expect(rateLimited.length).toBeGreaterThanOrEqual(BURST_RECIPIENTS.length - 2);
    expect(rateLimited).toEqual(
      rateLimited.map((): RateLimitedExpectation => ({
        kind: 'rate-limited',
        retryAfterMs: 1_000,
      })),
    );
  });

  it.each<RetryAfterHeaderCase>([
    ['초 단위 값', 3_000, { 'retry-after': '3' }],
    ['0', 0, { 'retry-after': '0' }],
    ['1시간을 넘는 값', 3_600_000, { 'retry-after': '7200' }],
    ['Number로 바꾸면 Infinity가 되는 긴 값', 3_600_000, { 'retry-after': '9'.repeat(400) }],
    ['헤더 없음', 1_000, {}],
    ['HTTP-date 형식', 1_000, { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' }],
    ['숫자가 아닌 값', 1_000, { 'retry-after': 'soon' }],
  ])(
    'EXT-04 429의 Retry-After가 %s이면 retryAfterMs는 %s ms가 된다 (1시간 상한, 없거나 형식이 다르면 1초)',
    async (
      _label: string,
      expectedMs: number,
      headers: Readonly<Record<string, string>>,
    ): Promise<void> => {
      const stub: StubHttpServer = await StubHttpServer.respondingWith({
        status: 429,
        headers: { 'content-type': 'application/json', ...headers },
        body: '{"code":"RATE_LIMITED","message":"rate limit exceeded"}',
      });

      const outcome: SendOutcome = await sendThrough(stub);

      expect(outcome).toEqual({ kind: 'rate-limited', retryAfterMs: expectedMs });
    },
  );

  it('EXT-05 ERROR_RATE=1 mock / 발송 → TransientFailure 결과가 나온다', async (): Promise<void> => {
    const outcome: SendOutcome = await senderAt(failingMock.baseUrl).send(messageTo('u_000001'));

    expect(outcome).toEqual({ kind: 'transient-failure' });
  });

  it.each<TransientStatusCase>([[500], [503]])(
    'EXT-05 %s 응답은 발송되지 않았으므로 TransientFailure 결과가 나온다',
    async (status: number): Promise<void> => {
      const stub: StubHttpServer = await StubHttpServer.respondingWith({
        status,
        headers: { 'content-type': 'application/json' },
        body: '{"code":"INTERNAL_ERROR","message":"try again"}',
      });

      const outcome: SendOutcome = await sendThrough(stub);

      expect(outcome).toEqual({ kind: 'transient-failure' });
    },
  );

  it('EXT-06 TIMEOUT_RATE=1 mock / 발송 → 클라이언트 타임아웃 후 Indeterminate 결과가 나온다', async (): Promise<void> => {
    const sender: MockMessageSenderAdapter = new MockMessageSenderAdapter({
      baseUrl: stallingMock.baseUrl,
      requestTimeoutMs: requestTimeoutMs(SHORT_TIMEOUT_MS),
    });
    const startedAt: number = performance.now();

    const outcome: SendOutcome = await sender.send(messageTo('u_000001'));

    expect(outcome).toEqual({ kind: 'indeterminate' });
    expect(performance.now() - startedAt).toBeLessThan(REQUEST_TIMEOUT_MS);
  });

  it('EXT-06 202 응답 본문이 제한 시간 안에 끝나지 않으면 Indeterminate 결과가 나온다', async (): Promise<void> => {
    const stub: StubHttpServer = await StubHttpServer.streamingEndlessly(202);
    try {
      const outcome: SendOutcome = await new MockMessageSenderAdapter({
        baseUrl: stub.baseUrl,
        requestTimeoutMs: requestTimeoutMs(SHORT_TIMEOUT_MS),
      }).send(messageTo('u_000001'));

      expect(outcome).toEqual({ kind: 'indeterminate' });
    } finally {
      await stub.close();
    }
  });

  it('EXT-06 연결할 수 없는 주소로 발송하면 예외 대신 Indeterminate 결과가 나온다', async (): Promise<void> => {
    const stub: StubHttpServer = await StubHttpServer.respondingWith({
      status: 202,
      headers: {},
      body: '',
    });
    await stub.close();

    const outcome: SendOutcome = await senderAt(stub.baseUrl).send(messageTo('u_000001'));

    expect(outcome).toEqual({ kind: 'indeterminate' });
  });
});
