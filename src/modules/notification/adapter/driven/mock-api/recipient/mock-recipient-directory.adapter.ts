import { HttpStatus } from '@nestjs/common';
import { z } from 'zod';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import { RecipientId } from '@/modules/notification/domain/alarm/alarm.type';
import { RecipientDirectoryPort } from '@/modules/notification/application/port/driven/for-fetching-recipients/recipient-directory.port';
import {
  FollowingPage,
  PageCursor,
  RecipientPage,
} from '@/modules/notification/application/port/driven/for-fetching-recipients/recipient-directory.type';
import { MockApiHttp } from '@/modules/notification/adapter/driven/mock-api/mock-api-http.util';
import { usersBodySchema } from '@/modules/notification/adapter/driven/mock-api/mock-api.schema';
import { RecipientDirectorySettings } from '@/modules/notification/adapter/driven/mock-api/mock-api.type';

type UsersBody = z.output<typeof usersBodySchema>;

type UserEntry = UsersBody['users'][number];

interface PageFetched {
  readonly kind: 'page';
  readonly page: RecipientPage;
}

interface DirectoryFailed {
  readonly kind: 'failed';
  readonly reason: string;
}

type DirectoryFetch = PageFetched | DirectoryFailed;

export class MockRecipientDirectoryAdapter implements RecipientDirectoryPort {
  private static readonly OK: number = HttpStatus.OK;

  constructor(
    private readonly settings: Readonly<RecipientDirectorySettings>,
    private readonly shutdownAbortSignal: AbortSignal,
  ) {}

  async fetchPage(cursor: PageCursor): Promise<RecipientPage> {
    const fetched: DirectoryFetch = await MockApiHttp.attempt(
      (): Promise<DirectoryFetch> => this.request(cursor),
      {
        notConnected: { kind: 'failed', reason: 'is unreachable' },
        interrupted: {
          kind: 'failed',
          reason: 'dropped the connection, timed out or was aborted at shutdown',
        },
      },
    );
    if (fetched.kind === 'failed') {
      throw new Error(`recipient directory ${fetched.reason}`);
    }
    return fetched.page;
  }

  private async request(cursor: PageCursor): Promise<DirectoryFetch> {
    const url: URL = new URL('/v1/users', this.settings.baseUrl);
    url.searchParams.set('limit', String(this.settings.pageLimit));
    if (cursor.kind === 'next') {
      url.searchParams.set('cursor', cursor.token);
    }
    const response: Response = await fetch(url, {
      signal: MockApiHttp.requestSignal(this.settings.requestTimeoutMs, this.shutdownAbortSignal),
    });
    if (response.status !== MockRecipientDirectoryAdapter.OK) {
      await MockApiHttp.discardBody(response);
      return { kind: 'failed', reason: `responded with status ${response.status}` };
    }
    const body: z.ZodSafeParseResult<UsersBody> = await MockApiHttp.parse(
      response,
      usersBodySchema,
    );
    return body.success
      ? MockRecipientDirectoryAdapter.toPage(body.data)
      : { kind: 'failed', reason: 'responded with an unexpected body' };
  }

  private static toPage({ users, nextCursor }: Readonly<UsersBody>): DirectoryFetch {
    const recipientIds: ReadonlyArray<RecipientId> = users.flatMap(
      ({ id: userId }: UserEntry): ReadonlyArray<RecipientId> =>
        AlarmPredicates.isRecipientId(userId) ? [userId] : [],
    );
    if (recipientIds.length !== users.length) {
      return { kind: 'failed', reason: 'responded with an invalid user id' };
    }
    const next: FollowingPage =
      typeof nextCursor === 'string' ? { kind: 'next', token: nextCursor } : { kind: 'end' };
    return { kind: 'page', page: { recipientIds, next } };
  }
}
