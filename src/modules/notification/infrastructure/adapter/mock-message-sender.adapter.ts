import { z } from 'zod';
import { DeliveryPredicates } from '@/modules/notification/domain/delivery/delivery.predicate';
import { MessageSenderPort } from '@/modules/notification/application/port/message-sender.port';
import {
  OutgoingMessage,
  SendOutcome,
} from '@/modules/notification/application/port/message-sender.type';
import {
  acceptedBodySchema,
  rejectedBodySchema,
} from '@/modules/notification/infrastructure/adapter/mock-api.schema';
import { MockApiSettings } from '@/modules/notification/infrastructure/adapter/mock-api.type';

type AcceptedBodyParse = z.ZodSafeParseResult<z.output<typeof acceptedBodySchema>>;

type RejectedBodyParse = z.ZodSafeParseResult<z.output<typeof rejectedBodySchema>>;

export class MockMessageSenderAdapter implements MessageSenderPort {
  private static readonly ACCEPTED: number = 202;

  private static readonly REJECTED: number = 400;

  constructor(private readonly settings: Readonly<MockApiSettings>) {}

  async send(message: OutgoingMessage): Promise<SendOutcome> {
    const response: Response = await fetch(new URL('/v1/messages', this.settings.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(message),
    });
    if (response.status === MockMessageSenderAdapter.ACCEPTED) {
      return MockMessageSenderAdapter.accepted(
        await MockMessageSenderAdapter.parse(response, acceptedBodySchema),
      );
    }
    if (response.status === MockMessageSenderAdapter.REJECTED) {
      return MockMessageSenderAdapter.rejected(
        await MockMessageSenderAdapter.parse(response, rejectedBodySchema),
      );
    }
    await MockMessageSenderAdapter.discardBody(response);
    return { kind: 'indeterminate' };
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

  private static async parse<TSchema extends z.ZodType>(
    response: Response,
    schema: TSchema,
  ): Promise<z.ZodSafeParseResult<z.output<TSchema>>> {
    return schema.safeParse(await response.json().catch((): string => ''));
  }

  private static async discardBody({ body }: Response): Promise<void> {
    if (body instanceof ReadableStream) {
      await body.cancel();
    }
  }
}
