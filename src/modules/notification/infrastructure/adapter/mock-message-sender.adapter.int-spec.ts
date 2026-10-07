import { randomUUID } from 'node:crypto';
import { scheduler } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import { DeliveryPredicates } from '@/modules/notification/domain/delivery/delivery.predicate';
import {
  OutgoingMessage,
  SendOutcome,
  SendOutcomeKind,
} from '@/modules/notification/application/port/message-sender.type';
import { MockMessageSenderAdapter } from '@/modules/notification/infrastructure/adapter/mock-message-sender.adapter';
import { MockApiContainer } from '@/modules/notification/infrastructure/testing/mock-api.container';
import { StubHttpServer } from '@/modules/notification/infrastructure/testing/stub-http.server';

type ConnectionState = 'released' | 'held';

type UnreadBodyCase = Readonly<[number, SendOutcomeKind]>;

type RetryAfterHeaderCase = Readonly<[string, number, Readonly<Record<string, string>>]>;

const RELEASE_WAIT_MS: number = 1_000;

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

const sendThrough = async (stub: StubHttpServer): Promise<SendOutcome> => {
  try {
    return await new MockMessageSenderAdapter({ baseUrl: stub.baseUrl }).send(
      messageTo('u_000001'),
    );
  } finally {
    await stub.close();
  }
};

describe('MockMessageSenderAdapter', () => {
  let deterministicMock: MockApiContainer;
  let blockingMock: MockApiContainer;
  let throttledMock: MockApiContainer;

  beforeAll(async (): Promise<void> => {
    [deterministicMock, blockingMock, throttledMock] = await Promise.all([
      MockApiContainer.start({}),
      MockApiContainer.start({ BLOCKED_PERCENT: '100' }),
      MockApiContainer.start({ RATE_LIMIT: '1' }),
    ]);
  });

  afterAll(async (): Promise<void> => {
    await Promise.all([deterministicMock.stop(), blockingMock.stop(), throttledMock.stop()]);
  });

  it('EXT-02 mock 발송 API / 정상 발송 → Accepted(messageId) 결과가 나온다', async (): Promise<void> => {
    const sender: MockMessageSenderAdapter = new MockMessageSenderAdapter({
      baseUrl: deterministicMock.baseUrl,
    });

    const outcome: SendOutcome = await sender.send(messageTo('u_000001'));

    expect(outcome).toEqual({ kind: 'accepted', messageId: expect.stringMatching(/^m_\d+$/) });
  });

  it('EXT-03 수신 거부 사용자 / 발송 → PermanentFailure(RECIPIENT_BLOCKED) 결과가 나온다', async (): Promise<void> => {
    const sender: MockMessageSenderAdapter = new MockMessageSenderAdapter({
      baseUrl: blockingMock.baseUrl,
    });

    const outcome: SendOutcome = await sender.send(messageTo('u_000001'));

    expect(outcome).toEqual({ kind: 'permanent-failure', code: 'RECIPIENT_BLOCKED' });
  });

  it('EXT-03 존재하지 않는 사용자 / 발송 → PermanentFailure(UNKNOWN_RECIPIENT) 결과가 나온다', async (): Promise<void> => {
    const sender: MockMessageSenderAdapter = new MockMessageSenderAdapter({
      baseUrl: deterministicMock.baseUrl,
    });

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
    [503, 'indeterminate'],
    [429, 'rate-limited'],
  ])(
    'EXT-02 본문을 읽지 않는 %s 응답이면 결과(%s)를 돌려주기 전에 본문을 취소해 연결을 놓아준다',
    async (status: number, expectedKind: SendOutcomeKind): Promise<void> => {
      const stub: StubHttpServer = await StubHttpServer.streamingEndlessly(status);
      try {
        const outcome: SendOutcome = await new MockMessageSenderAdapter({
          baseUrl: stub.baseUrl,
        }).send(messageTo('u_000001'));
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
    const sender: MockMessageSenderAdapter = new MockMessageSenderAdapter({
      baseUrl: throttledMock.baseUrl,
    });

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

  it.todo('EXT-05 ERROR_RATE=1 mock / 발송 → TransientFailure 결과가 나온다');
  it.todo('EXT-06 TIMEOUT_RATE=1 mock / 발송 → 클라이언트 타임아웃 후 Indeterminate 결과가 나온다');
  it.todo('EXT-07 이미 발송된 clientRef / 발송 내역을 조회한다 → messageId가 담긴 내역이 나온다');
  it.todo('EXT-08 발송하지 않은 clientRef / 발송 내역을 조회한다 → 빈 내역이 나온다');
  it.todo(
    'EXT-09 조회 API가 오류를 내거나 스키마와 다른 응답을 준다 / 발송 내역을 조회한다 → 빈 내역이 아니라 LookupFailed 결과가 나온다',
  );
  it.todo(
    'EXT-10 기본 RATE_LIMIT mock / 제한기를 거쳐 2초 동안 연속 발송한다 → 429가 나오지 않는다 (mock 한도 구간 방식에 대한 특성 테스트)',
  );
  it.todo(
    'EXT-11 TIMEOUT_RATE=1 mock / 발송 요청 직후 응답을 기다리는 동안 발송 내역을 조회한다 → 내역이 이미 있다 (발송 기록 시점에 대한 특성 테스트, reconcile 가정의 근거)',
  );
});
