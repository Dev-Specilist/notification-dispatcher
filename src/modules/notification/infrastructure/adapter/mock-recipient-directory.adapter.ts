import { z } from 'zod';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import { RecipientId } from '@/modules/notification/domain/alarm/alarm.type';
import { RecipientDirectoryPort } from '@/modules/notification/application/port/recipient-directory.port';
import {
  FollowingPage,
  PageCursor,
  RecipientPage,
} from '@/modules/notification/application/port/recipient-directory.type';
import { MockApiHttp } from '@/modules/notification/infrastructure/adapter/mock-api-http.util';
import { usersBodySchema } from '@/modules/notification/infrastructure/adapter/mock-api.schema';
import { RecipientDirectorySettings } from '@/modules/notification/infrastructure/adapter/mock-api.type';

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
  private static readonly OK: number = 200;

  constructor(private readonly settings: Readonly<RecipientDirectorySettings>) {}

  async fetchPage(cursor: PageCursor): Promise<RecipientPage> {
    const fetched: DirectoryFetch = await MockApiHttp.attempt(
      (): Promise<DirectoryFetch> => this.request(cursor),
      { kind: 'failed', reason: 'is unreachable or timed out' },
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
      signal: AbortSignal.timeout(this.settings.requestTimeoutMs),
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
      ({ id }: UserEntry): ReadonlyArray<RecipientId> =>
        AlarmPredicates.isRecipientId(id) ? [id] : [],
    );
    if (recipientIds.length !== users.length) {
      return { kind: 'failed', reason: 'responded with an invalid user id' };
    }
    const next: FollowingPage =
      typeof nextCursor === 'string' ? { kind: 'next', token: nextCursor } : { kind: 'end' };
    return { kind: 'page', page: { recipientIds, next } };
  }
}
