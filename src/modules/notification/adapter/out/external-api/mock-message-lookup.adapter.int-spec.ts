import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import { DeliveryPredicates } from '@/modules/notification/domain/delivery/delivery.predicate';
import { DeliveryId, RecordedMessage } from '@/modules/notification/domain/delivery/delivery.type';
import { MessageLookupResult } from '@/modules/notification/application/port/out/message-lookup.type';
import {
  OutgoingMessage,
  SendOutcome,
} from '@/modules/notification/application/port/out/message-sender.type';
import { MockApiPredicates } from '@/modules/notification/adapter/out/external-api/mock-api.predicate';
import { RequestTimeoutMs } from '@/modules/notification/adapter/out/external-api/mock-api.type';
import { MockMessageLookupAdapter } from '@/modules/notification/adapter/out/external-api/mock-message-lookup.adapter';
import { MockMessageSenderAdapter } from '@/modules/notification/adapter/out/external-api/mock-message-sender.adapter';
import { MockApiContainer } from '@/modules/notification/testing/mock-api.container';
import { StubHttpServer } from '@/modules/notification/testing/stub-http.server';

type MalformedResponseCase = Readonly<[string, number, string]>;

interface FoundSummary {
  readonly kind: 'found';
  readonly messageIds: ReadonlyArray<string>;
  readonly sentAtValid: boolean;
}

const REQUEST_TIMEOUT_MS: number = 5_000;

const SHORT_TIMEOUT_MS: number = 300;

const requestTimeoutMs = (value: number): RequestTimeoutMs => {
  if (!MockApiPredicates.isRequestTimeoutMs(value)) {
    throw new Error(`test fixture ${value} is not a valid RequestTimeoutMs`);
  }
  return value;
};

const newClientRef = (): DeliveryId => {
  const value: string = randomUUID();
  if (!DeliveryPredicates.isDeliveryId(value)) {
    throw new Error(`generated ${value} is not a valid DeliveryId`);
  }
  return value;
};

const messageWith = (clientRef: DeliveryId): OutgoingMessage => {
  const alarmId: string = randomUUID();
  const recipientId: string = 'u_000001';
  if (!AlarmPredicates.isAlarmId(alarmId) || !AlarmPredicates.isRecipientId(recipientId)) {
    throw new Error('test fixture message is invalid');
  }
  return { alarmId, recipientId, body: '추석 이벤트 안내', clientRef };
};

const acceptedMessageId = (outcome: SendOutcome): string => {
  if (outcome.kind !== 'accepted') {
    throw new Error(`expected the mock to accept the message but got ${outcome.kind}`);
  }
  return outcome.messageId;
};

const summarize = (result: MessageLookupResult): FoundSummary => {
  if (result.kind !== 'found') {
    throw new Error(`expected found but got ${result.kind}`);
  }
  return {
    kind: 'found',
    messageIds: result.messages.map(({ messageId }: RecordedMessage): string => messageId),
    sentAtValid: result.messages.every(
      ({ sentAt }: RecordedMessage): boolean => !Number.isNaN(sentAt.getTime()),
    ),
  };
};

const lookupAt = (baseUrl: URL, timeoutMs: number): MockMessageLookupAdapter =>
  new MockMessageLookupAdapter({ baseUrl, requestTimeoutMs: requestTimeoutMs(timeoutMs) });

const lookupThrough = async (stub: StubHttpServer): Promise<MessageLookupResult> => {
  try {
    return await lookupAt(stub.baseUrl, REQUEST_TIMEOUT_MS).findByClientRef(newClientRef());
  } finally {
    await stub.close();
  }
};

describe('MockMessageLookupAdapter', () => {
  let mock: MockApiContainer;

  beforeAll(async (): Promise<void> => {
    mock = await MockApiContainer.start({});
  });

  afterAll(async (): Promise<void> => {
    await mock.stop();
  });

  it('EXT-07 이미 발송된 clientRef / 발송 내역을 조회한다 → messageId가 담긴 내역이 나온다', async (): Promise<void> => {
    const clientRef: DeliveryId = newClientRef();
    const sender: MockMessageSenderAdapter = new MockMessageSenderAdapter({
      baseUrl: mock.baseUrl,
      requestTimeoutMs: requestTimeoutMs(REQUEST_TIMEOUT_MS),
    });
    const messageId: string = acceptedMessageId(await sender.send(messageWith(clientRef)));

    const result: MessageLookupResult = await lookupAt(
      mock.baseUrl,
      REQUEST_TIMEOUT_MS,
    ).findByClientRef(clientRef);

    expect(summarize(result)).toEqual({
      kind: 'found',
      messageIds: [messageId],
      sentAtValid: true,
    });
  });

  it('EXT-07 같은 clientRef로 두 번 발송됐으면 두 내역이 모두 나온다', async (): Promise<void> => {
    const clientRef: DeliveryId = newClientRef();
    const sender: MockMessageSenderAdapter = new MockMessageSenderAdapter({
      baseUrl: mock.baseUrl,
      requestTimeoutMs: requestTimeoutMs(REQUEST_TIMEOUT_MS),
    });
    const first: string = acceptedMessageId(await sender.send(messageWith(clientRef)));
    const second: string = acceptedMessageId(await sender.send(messageWith(clientRef)));

    const result: MessageLookupResult = await lookupAt(
      mock.baseUrl,
      REQUEST_TIMEOUT_MS,
    ).findByClientRef(clientRef);

    expect(summarize(result)).toEqual({
      kind: 'found',
      messageIds: [first, second],
      sentAtValid: true,
    });
  });

  it('EXT-08 발송하지 않은 clientRef / 발송 내역을 조회한다 → 빈 내역이 나온다', async (): Promise<void> => {
    const result: MessageLookupResult = await lookupAt(
      mock.baseUrl,
      REQUEST_TIMEOUT_MS,
    ).findByClientRef(newClientRef());

    expect(result).toEqual({ kind: 'none' });
  });

  it.each<MalformedResponseCase>([
    ['500 오류', 500, '{"code":"INTERNAL_ERROR","message":"boom"}'],
    ['400 오류', 400, '{"code":"INVALID_REQUEST","message":"clientRef is required"}'],
    ['본문은 빈 내역 형식인 503 오류', 503, '{"messages":[]}'],
    ['messages 필드가 없는 200', 200, '{"items":[]}'],
    ['messages가 배열이 아닌 200', 200, '{"messages":"none"}'],
    [
      'sentAt이 날짜가 아닌 200',
      200,
      '{"messages":[{"messageId":"m_1","recipientId":"u_000001","sentAt":"yesterday"}]}',
    ],
    [
      'messageId가 비어 있는 200',
      200,
      '{"messages":[{"messageId":"","recipientId":"u_000001","sentAt":"2026-10-08T00:00:00.000Z"}]}',
    ],
    ['JSON이 아닌 200', 200, 'not json'],
  ])(
    'EXT-09 조회 API가 오류를 내거나 스키마와 다른 응답을 준다(%s) / 발송 내역을 조회한다 → 빈 내역이 아니라 LookupFailed 결과가 나온다',
    async (_label: string, status: number, body: string): Promise<void> => {
      const stub: StubHttpServer = await StubHttpServer.respondingWith({
        status,
        headers: { 'content-type': 'application/json' },
        body,
      });

      const result: MessageLookupResult = await lookupThrough(stub);

      expect(result).toEqual({ kind: 'lookup-failed' });
    },
  );

  it('EXT-09 조회 응답이 제한 시간 안에 끝나지 않으면 LookupFailed 결과가 나온다', async (): Promise<void> => {
    const stub: StubHttpServer = await StubHttpServer.streamingEndlessly(200);
    try {
      const result: MessageLookupResult = await lookupAt(
        stub.baseUrl,
        SHORT_TIMEOUT_MS,
      ).findByClientRef(newClientRef());

      expect(result).toEqual({ kind: 'lookup-failed' });
    } finally {
      await stub.close();
    }
  });

  it('EXT-09 조회 API에 연결할 수 없으면 예외 대신 LookupFailed 결과가 나온다', async (): Promise<void> => {
    const stub: StubHttpServer = await StubHttpServer.respondingWith({
      status: 200,
      headers: {},
      body: '',
    });
    await stub.close();

    const result: MessageLookupResult = await lookupAt(
      stub.baseUrl,
      REQUEST_TIMEOUT_MS,
    ).findByClientRef(newClientRef());

    expect(result).toEqual({ kind: 'lookup-failed' });
  });
});
