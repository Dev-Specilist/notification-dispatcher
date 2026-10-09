import { z } from 'zod';
import { DeliveryPredicates } from '@/modules/notification/domain/delivery/delivery.predicate';
import { DeliveryId, RecordedMessage } from '@/modules/notification/domain/delivery/delivery.type';
import { MessageLookupPort } from '@/modules/notification/application/port/out/message-lookup.port';
import { MessageLookupResult } from '@/modules/notification/application/port/out/message-lookup.type';
import { MockApiHttp } from '@/modules/notification/adapter/out/external-api/mock-api-http.util';
import { lookupBodySchema } from '@/modules/notification/adapter/out/external-api/mock-api.schema';
import { MockApiSettings } from '@/modules/notification/adapter/out/external-api/mock-api.type';

type LookupBody = z.output<typeof lookupBodySchema>;

type LookupMessage = LookupBody['messages'][number];

export class MockMessageLookupAdapter implements MessageLookupPort {
  private static readonly OK: number = 200;

  constructor(private readonly settings: Readonly<MockApiSettings>) {}

  findByClientRef(clientRef: DeliveryId): Promise<MessageLookupResult> {
    return MockApiHttp.attempt((): Promise<MessageLookupResult> => this.request(clientRef), {
      notConnected: { kind: 'lookup-failed' },
      interrupted: { kind: 'lookup-failed' },
    });
  }

  private async request(clientRef: DeliveryId): Promise<MessageLookupResult> {
    const url: URL = new URL('/v1/messages', this.settings.baseUrl);
    url.searchParams.set('clientRef', clientRef);
    const response: Response = await fetch(url, {
      signal: AbortSignal.timeout(this.settings.requestTimeoutMs),
    });
    if (response.status !== MockMessageLookupAdapter.OK) {
      await MockApiHttp.discardBody(response);
      return { kind: 'lookup-failed' };
    }
    const body: z.ZodSafeParseResult<LookupBody> = await MockApiHttp.parse(
      response,
      lookupBodySchema,
    );
    return body.success ? MockMessageLookupAdapter.toResult(body.data) : { kind: 'lookup-failed' };
  }

  private static toResult({ messages }: Readonly<LookupBody>): MessageLookupResult {
    const recorded: ReadonlyArray<RecordedMessage> = messages.flatMap(
      ({ messageId, sentAt }: LookupMessage): ReadonlyArray<RecordedMessage> =>
        DeliveryPredicates.isMessageId(messageId) ? [{ messageId, sentAt: new Date(sentAt) }] : [],
    );
    if (recorded.length !== messages.length) {
      return { kind: 'lookup-failed' };
    }
    if (recorded.length === 0) {
      return { kind: 'none' };
    }
    const [firstMessage, ...otherMessages]: ReadonlyArray<RecordedMessage> = recorded;
    return { kind: 'found', messages: [firstMessage, ...otherMessages] };
  }
}
