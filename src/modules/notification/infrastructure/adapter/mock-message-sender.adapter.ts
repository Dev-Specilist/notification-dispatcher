import { z } from 'zod';
import { DeliveryPredicates } from '@/modules/notification/domain/delivery/delivery.predicate';
import { RetryAfterMs } from '@/modules/notification/domain/delivery/delivery.type';
import { MessageSenderPort } from '@/modules/notification/application/port/out/message-sender.port';
import {
  OutgoingMessage,
  SendOutcome,
} from '@/modules/notification/application/port/out/message-sender.type';
import {
  acceptedBodySchema,
  rejectedBodySchema,
  retryAfterSecondsSchema,
} from '@/modules/notification/infrastructure/adapter/mock-api.schema';
import { MockApiHttp } from '@/modules/notification/infrastructure/adapter/mock-api-http.util';
import { MockApiSettings } from '@/modules/notification/infrastructure/adapter/mock-api.type';

type AcceptedBodyParse = z.ZodSafeParseResult<z.output<typeof acceptedBodySchema>>;

type RejectedBodyParse = z.ZodSafeParseResult<z.output<typeof rejectedBodySchema>>;

type RetryAfterSecondsParse = z.ZodSafeParseResult<z.output<typeof retryAfterSecondsSchema>>;

export class MockMessageSenderAdapter implements MessageSenderPort {
  private static readonly ACCEPTED: number = 202;

  private static readonly REJECTED: number = 400;

  private static readonly RATE_LIMITED: number = 429;

  private static readonly NOT_SENT_FAILURES: ReadonlyArray<number> = [500, 503];

  private static readonly DEFAULT_RETRY_AFTER_MS: number = 1_000;

  constructor(private readonly settings: Readonly<MockApiSettings>) {}

  send(message: OutgoingMessage): Promise<SendOutcome> {
    return MockApiHttp.attempt((): Promise<SendOutcome> => this.request(message), {
      kind: 'indeterminate',
    });
  }

  private async request(message: OutgoingMessage): Promise<SendOutcome> {
    const response: Response = await fetch(new URL('/v1/messages', this.settings.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(this.settings.requestTimeoutMs),
    });
    if (response.status === MockMessageSenderAdapter.ACCEPTED) {
      return MockMessageSenderAdapter.accepted(
        await MockApiHttp.parse(response, acceptedBodySchema),
      );
    }
    if (response.status === MockMessageSenderAdapter.REJECTED) {
      return MockMessageSenderAdapter.rejected(
        await MockApiHttp.parse(response, rejectedBodySchema),
      );
    }
    await MockApiHttp.discardBody(response);
    if (MockMessageSenderAdapter.NOT_SENT_FAILURES.includes(response.status)) {
      return { kind: 'transient-failure' };
    }
    if (response.status === MockMessageSenderAdapter.RATE_LIMITED) {
      return {
        kind: 'rate-limited',
        retryAfterMs: MockMessageSenderAdapter.retryAfterOf(response.headers),
      };
    }
    return { kind: 'indeterminate' };
  }

  private static retryAfterOf(headers: Headers): RetryAfterMs {
    const seconds: RetryAfterSecondsParse = retryAfterSecondsSchema.safeParse(
      headers.get('retry-after'),
    );
    const milliseconds: number = seconds.success
      ? Math.min(seconds.data * 1_000, DeliveryPredicates.MAX_RETRY_AFTER_MS)
      : MockMessageSenderAdapter.DEFAULT_RETRY_AFTER_MS;
    if (!DeliveryPredicates.isRetryAfterMs(milliseconds)) {
      throw new Error(`Retry-After ${milliseconds}ms is outside the allowed range`);
    }
    return milliseconds;
  }

  private static accepted(body: AcceptedBodyParse): SendOutcome {
    if (!body.success || !DeliveryPredicates.isMessageId(body.data.messageId)) {
      return { kind: 'indeterminate' };
    }
    return { kind: 'accepted', messageId: body.data.messageId };
  }

  private static rejected(body: RejectedBodyParse): SendOutcome {
    return { kind: 'permanent-failure', code: body.success ? body.data.code : 'INVALID_REQUEST' };
  }
}
