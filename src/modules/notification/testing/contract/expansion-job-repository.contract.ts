import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import { AlarmCreation, AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import { AlarmRepositoryPort } from '@/modules/notification/application/port/driven/for-storing-alarms/alarm-repository.port';
import { ExpansionJob } from '@/modules/notification/domain/expansion/expansion-job.entity';
import {
  ExpansionJobSnapshot,
  ExpansionProgress,
} from '@/modules/notification/domain/expansion/expansion-job.type';
import { ExpansionJobRepositoryPort } from '@/modules/notification/application/port/driven/for-storing-expansion-jobs/expansion-job-repository.port';
import {
  ExpansionClaim,
  ExpansionJobLookup,
} from '@/modules/notification/application/port/driven/for-storing-expansion-jobs/expansion-job-repository.type';
import { KindAssertion, KindMember } from '@/shared/testing/kind.assertion';

type ContractExpansionJobRepository = ExpansionJobRepositoryPort;

interface ContractRepositories {
  readonly alarmRepository: AlarmRepositoryPort;
  readonly expansionJobRepository: ContractExpansionJobRepository;
}

interface Scenario extends ContractRepositories {
  readonly owner: AlarmId;
}

type RepositoriesFactory = () => Promise<ContractRepositories>;

type ProgressCase = Readonly<[string, ExpansionProgress]>;

const ENQUEUED_ISO: string = '2026-10-08T09:00:00.000Z';
const FINISHED_ISO: string = '2026-10-08T09:10:00.000Z';
const LATER_ENQUEUED_ISO: string = '2026-10-08T09:01:00.000Z';
const CLAIMED_ISO: string = '2026-10-08T09:20:00.000Z';
const LEASED_UNTIL_ISO: string = '2026-10-08T09:20:30.000Z';
const AFTER_LEASE_ISO: string = '2026-10-08T09:20:31.000Z';
const LEASE_MS: number = new Date(LEASED_UNTIL_ISO).getTime() - new Date(CLAIMED_ISO).getTime();

export class ExpansionJobRepositoryContract {
  static verify(createRepositories: RepositoriesFactory): void {
    it('UC-04 확장 작업을 만들면 첫 페이지부터 읽는 진행 중 상태로 저장된다', async (): Promise<void> => {
      const { expansionJobRepository, owner }: Scenario =
        await ExpansionJobRepositoryContract.scenario(createRepositories);

      await expansionJobRepository.enqueue(owner, new Date(ENQUEUED_ISO));

      expect(
        ExpansionJobRepositoryContract.snapshotOf(
          await expansionJobRepository.findByAlarmId(owner),
        ),
      ).toEqual({
        alarmId: owner,
        enqueuedAt: new Date(ENQUEUED_ISO),
        progress: { kind: 'in-progress', cursor: { kind: 'first' } },
      });
    });

    it.each<ProgressCase>([
      ['다음 페이지 cursor', { kind: 'in-progress', cursor: { kind: 'next', token: 'Mw' } }],
      ['완료', { kind: 'completed', completedAt: new Date(FINISHED_ISO) }],
      ['중단', { kind: 'stopped', stoppedAt: new Date(FINISHED_ISO) }],
    ])(
      'UC-06 확장 진행을 %s(으)로 기록하면 그대로 조회된다',
      async (_label: string, progress: ExpansionProgress): Promise<void> => {
        const { expansionJobRepository, owner }: Scenario =
          await ExpansionJobRepositoryContract.scenario(createRepositories);
        await expansionJobRepository.enqueue(owner, new Date(ENQUEUED_ISO));

        await expansionJobRepository.save(ExpansionJobRepositoryContract.jobWith(owner, progress));

        expect(
          ExpansionJobRepositoryContract.snapshotOf(
            await expansionJobRepository.findByAlarmId(owner),
          ),
        ).toEqual({ alarmId: owner, enqueuedAt: new Date(ENQUEUED_ISO), progress });
      },
    );

    it('DB-18 진행 중인 확장 작업 여러 개 / 워커가 확장 작업을 claim한다 → lease가 없거나 만료된 작업 중 가장 먼저 만든 작업을 잡아 lease를 걸고, 잡힌 작업은 다른 워커가 가져가지 않는다', async (): Promise<void> => {
      const { alarmRepository, expansionJobRepository, owner }: Scenario =
        await ExpansionJobRepositoryContract.scenario(createRepositories);
      const laterAlarmId: AlarmId =
        await ExpansionJobRepositoryContract.storedAlarm(alarmRepository);
      await expansionJobRepository.enqueue(laterAlarmId, new Date(LATER_ENQUEUED_ISO));
      await expansionJobRepository.enqueue(owner, new Date(ENQUEUED_ISO));

      const expansionClaims: ReadonlyArray<ExpansionClaim> = [
        await ExpansionJobRepositoryContract.claimAt(expansionJobRepository, CLAIMED_ISO),
        await ExpansionJobRepositoryContract.claimAt(expansionJobRepository, CLAIMED_ISO),
        await ExpansionJobRepositoryContract.claimAt(expansionJobRepository, CLAIMED_ISO),
      ];

      expect(expansionClaims).toEqual([
        { kind: 'claimed', alarmId: owner },
        { kind: 'claimed', alarmId: laterAlarmId },
        { kind: 'none' },
      ]);
    });

    it('DB-18 lease가 만료된 확장 작업은 다른 워커가 다시 잡는다', async (): Promise<void> => {
      const { expansionJobRepository, owner }: Scenario =
        await ExpansionJobRepositoryContract.scenario(createRepositories);
      await expansionJobRepository.enqueue(owner, new Date(ENQUEUED_ISO));
      await ExpansionJobRepositoryContract.claimAt(expansionJobRepository, CLAIMED_ISO);

      expect(
        await ExpansionJobRepositoryContract.claimAt(expansionJobRepository, AFTER_LEASE_ISO),
      ).toEqual({ kind: 'claimed', alarmId: owner });
    });

    it.each<ProgressCase>([
      ['완료', { kind: 'completed', completedAt: new Date(FINISHED_ISO) }],
      ['중단', { kind: 'stopped', stoppedAt: new Date(FINISHED_ISO) }],
    ])(
      'DB-18 %s된 확장 작업은 claim하지 않는다',
      async (_label: string, progress: ExpansionProgress): Promise<void> => {
        const { expansionJobRepository, owner }: Scenario =
          await ExpansionJobRepositoryContract.scenario(createRepositories);
        await expansionJobRepository.enqueue(owner, new Date(ENQUEUED_ISO));
        await expansionJobRepository.save(ExpansionJobRepositoryContract.jobWith(owner, progress));

        expect(
          await ExpansionJobRepositoryContract.claimAt(expansionJobRepository, CLAIMED_ISO),
        ).toEqual({ kind: 'none' });
      },
    );

    it('DB-18 진행을 기록하면 lease가 풀려 lease 만료 전에도 다시 claim할 수 있다', async (): Promise<void> => {
      const { expansionJobRepository, owner }: Scenario =
        await ExpansionJobRepositoryContract.scenario(createRepositories);
      await expansionJobRepository.enqueue(owner, new Date(ENQUEUED_ISO));
      await ExpansionJobRepositoryContract.claimAt(expansionJobRepository, CLAIMED_ISO);

      await expansionJobRepository.save(
        ExpansionJobRepositoryContract.jobWith(owner, {
          kind: 'in-progress',
          cursor: { kind: 'next', token: 'Mw' },
        }),
      );

      expect(
        await ExpansionJobRepositoryContract.claimAt(expansionJobRepository, CLAIMED_ISO),
      ).toEqual({ kind: 'claimed', alarmId: owner });
    });

    it('UC-07 이미 있는 확장 작업을 다시 만들어도 기존 진행 상황을 유지한다', async (): Promise<void> => {
      const { expansionJobRepository, owner }: Scenario =
        await ExpansionJobRepositoryContract.scenario(createRepositories);
      await expansionJobRepository.enqueue(owner, new Date(ENQUEUED_ISO));
      await expansionJobRepository.save(
        ExpansionJobRepositoryContract.jobWith(owner, {
          kind: 'in-progress',
          cursor: { kind: 'next', token: 'Mw' },
        }),
      );

      await expansionJobRepository.enqueue(owner, new Date(FINISHED_ISO));

      expect(
        ExpansionJobRepositoryContract.snapshotOf(
          await expansionJobRepository.findByAlarmId(owner),
        ),
      ).toEqual({
        alarmId: owner,
        enqueuedAt: new Date(ENQUEUED_ISO),
        progress: { kind: 'in-progress', cursor: { kind: 'next', token: 'Mw' } },
      });
    });

    it.each<ProgressCase>([
      ['완료', { kind: 'completed', completedAt: new Date(FINISHED_ISO) }],
      ['중단', { kind: 'stopped', stoppedAt: new Date(FINISHED_ISO) }],
    ])(
      'UC-06 다음 페이지를 읽던 확장을 %s(으)로 바꾸면 그 상태로 조회된다',
      async (_label: string, finished: ExpansionProgress): Promise<void> => {
        const { expansionJobRepository, owner }: Scenario =
          await ExpansionJobRepositoryContract.scenario(createRepositories);
        await expansionJobRepository.enqueue(owner, new Date(ENQUEUED_ISO));
        await expansionJobRepository.save(
          ExpansionJobRepositoryContract.jobWith(owner, {
            kind: 'in-progress',
            cursor: { kind: 'next', token: 'Mw' },
          }),
        );

        await expansionJobRepository.save(ExpansionJobRepositoryContract.jobWith(owner, finished));

        expect(
          ExpansionJobRepositoryContract.snapshotOf(
            await expansionJobRepository.findByAlarmId(owner),
          ),
        ).toEqual({ alarmId: owner, enqueuedAt: new Date(ENQUEUED_ISO), progress: finished });
      },
    );

    it.each<ProgressCase>([
      ['완료', { kind: 'completed', completedAt: new Date(FINISHED_ISO) }],
      ['중단', { kind: 'stopped', stoppedAt: new Date(FINISHED_ISO) }],
    ])(
      'UC-07 %s된 확장 작업을 다시 만들어도 종결 상태를 유지한다',
      async (_label: string, finished: ExpansionProgress): Promise<void> => {
        const { expansionJobRepository, owner }: Scenario =
          await ExpansionJobRepositoryContract.scenario(createRepositories);
        await expansionJobRepository.enqueue(owner, new Date(ENQUEUED_ISO));
        await expansionJobRepository.save(ExpansionJobRepositoryContract.jobWith(owner, finished));

        await expansionJobRepository.enqueue(owner, new Date(FINISHED_ISO));

        expect(
          ExpansionJobRepositoryContract.snapshotOf(
            await expansionJobRepository.findByAlarmId(owner),
          ).progress,
        ).toEqual(finished);
      },
    );

    it('UC-06 조회한 완료·중단 시각을 바꿔도 저장된 값은 바뀌지 않는다', async (): Promise<void> => {
      const { expansionJobRepository, owner }: Scenario =
        await ExpansionJobRepositoryContract.scenario(createRepositories);
      await expansionJobRepository.enqueue(owner, new Date(ENQUEUED_ISO));
      await expansionJobRepository.save(
        ExpansionJobRepositoryContract.jobWith(owner, {
          kind: 'completed',
          completedAt: new Date(FINISHED_ISO),
        }),
      );

      const { progress }: ExpansionJobSnapshot = ExpansionJobRepositoryContract.snapshotOf(
        await expansionJobRepository.findByAlarmId(owner),
      );
      if (progress.kind === 'completed') {
        progress.completedAt.setUTCFullYear(1990);
      }

      expect(
        ExpansionJobRepositoryContract.snapshotOf(await expansionJobRepository.findByAlarmId(owner))
          .progress,
      ).toEqual({ kind: 'completed', completedAt: new Date(FINISHED_ISO) });
    });

    it('UC-06 확장 작업이 없는 알림은 없음으로 돌려준다', async (): Promise<void> => {
      const { expansionJobRepository, owner }: Scenario =
        await ExpansionJobRepositoryContract.scenario(createRepositories);

      expect(await expansionJobRepository.findByAlarmId(owner)).toEqual({ kind: 'missing' });
    });

    it('UC-07 잠그며 조회해도 기록된 확장 진행을 그대로 돌려준다', async (): Promise<void> => {
      const { expansionJobRepository, owner }: Scenario =
        await ExpansionJobRepositoryContract.scenario(createRepositories);
      await expansionJobRepository.enqueue(owner, new Date(ENQUEUED_ISO));
      await expansionJobRepository.save(
        ExpansionJobRepositoryContract.jobWith(owner, {
          kind: 'in-progress',
          cursor: { kind: 'next', token: 'Mw' },
        }),
      );

      expect(
        ExpansionJobRepositoryContract.snapshotOf(
          await expansionJobRepository.findByAlarmIdForUpdate(owner),
        ),
      ).toEqual({
        alarmId: owner,
        enqueuedAt: new Date(ENQUEUED_ISO),
        progress: { kind: 'in-progress', cursor: { kind: 'next', token: 'Mw' } },
      });
    });

    it('UC-07 확장 작업이 없는 알림을 잠그며 조회하면 없음으로 돌려준다', async (): Promise<void> => {
      const { expansionJobRepository, owner }: Scenario =
        await ExpansionJobRepositoryContract.scenario(createRepositories);

      expect(await expansionJobRepository.findByAlarmIdForUpdate(owner)).toEqual({
        kind: 'missing',
      });
    });

    it('UC-06 확장 작업이 없는 알림의 진행은 기록하지 않고 거부한다', async (): Promise<void> => {
      const { expansionJobRepository, owner }: Scenario =
        await ExpansionJobRepositoryContract.scenario(createRepositories);

      await expect(
        expansionJobRepository.save(
          ExpansionJobRepositoryContract.jobWith(owner, {
            kind: 'completed',
            completedAt: new Date(FINISHED_ISO),
          }),
        ),
      ).rejects.toBeInstanceOf(Error);
      expect(await expansionJobRepository.findByAlarmId(owner)).toEqual({ kind: 'missing' });
    });

    it('UC-06 조회한 확장 작업의 Date를 바꿔도 저장된 값은 바뀌지 않는다', async (): Promise<void> => {
      const { expansionJobRepository, owner }: Scenario =
        await ExpansionJobRepositoryContract.scenario(createRepositories);
      await expansionJobRepository.enqueue(owner, new Date(ENQUEUED_ISO));

      const { enqueuedAt }: ExpansionJobSnapshot = ExpansionJobRepositoryContract.snapshotOf(
        await expansionJobRepository.findByAlarmId(owner),
      );
      enqueuedAt.setUTCFullYear(1990);

      expect(
        ExpansionJobRepositoryContract.snapshotOf(await expansionJobRepository.findByAlarmId(owner))
          .enqueuedAt,
      ).toEqual(new Date(ENQUEUED_ISO));
    });
  }

  private static jobWith(owner: AlarmId, progress: ExpansionProgress): ExpansionJob {
    return ExpansionJob.reconstitute({
      alarmId: owner,
      enqueuedAt: new Date(ENQUEUED_ISO),
      progress,
    });
  }

  private static snapshotOf(lookup: ExpansionJobLookup): ExpansionJobSnapshot {
    KindAssertion.assertKind(lookup, 'found');
    const { job }: KindMember<ExpansionJobLookup, 'found'> = lookup;
    return job.snapshot();
  }

  private static claimAt(
    expansionJobRepository: ExpansionJobRepositoryPort,
    claimedIso: string,
  ): Promise<ExpansionClaim> {
    const claimedAt: Date = new Date(claimedIso);
    return expansionJobRepository.claimNext(claimedAt, new Date(claimedAt.getTime() + LEASE_MS));
  }

  private static async scenario(createRepositories: RepositoriesFactory): Promise<Scenario> {
    const repositories: ContractRepositories = await createRepositories();
    return {
      ...repositories,
      owner: await ExpansionJobRepositoryContract.storedAlarm(repositories.alarmRepository),
    };
  }

  private static async storedAlarm(alarmRepository: AlarmRepositoryPort): Promise<AlarmId> {
    const rawAlarmId: string = randomUUID();
    if (!AlarmPredicates.isAlarmId(rawAlarmId)) {
      throw new Error(`generated ${rawAlarmId} is not a valid AlarmId`);
    }
    const creation: AlarmCreation = Alarm.create(
      rawAlarmId,
      { title: '추석 이벤트', body: '쿠폰 도착', kind: 'BULK', recipientIds: [] },
      new Date(ENQUEUED_ISO),
    );
    KindAssertion.assertKind(creation, 'created');
    const { alarm }: KindMember<AlarmCreation, 'created'> = creation;
    await alarmRepository.save(alarm);
    return rawAlarmId;
  }
}
