import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { Alarm } from '@/modules/notification/domain/alarm/alarm.entity';
import { AlarmPredicates } from '@/modules/notification/domain/alarm/alarm.predicate';
import { AlarmCreation, AlarmId } from '@/modules/notification/domain/alarm/alarm.type';
import { AlarmRepositoryPort } from '@/modules/notification/application/port/alarm-repository.port';
import { ExpansionJobRepositoryPort } from '@/modules/notification/application/port/expansion-job-repository.port';
import {
  ExpansionJobLookup,
  ExpansionProgress,
} from '@/modules/notification/application/port/expansion-job-repository.type';

interface ContractRepositories {
  readonly alarmRepository: AlarmRepositoryPort;
  readonly expansionJobRepository: ExpansionJobRepositoryPort;
}

interface Scenario extends ContractRepositories {
  readonly owner: AlarmId;
}

type RepositoriesFactory = () => Promise<ContractRepositories>;

type ProgressCase = Readonly<[string, ExpansionProgress]>;

const ENQUEUED_ISO: string = '2026-10-08T09:00:00.000Z';
const FINISHED_ISO: string = '2026-10-08T09:10:00.000Z';

export class ExpansionJobRepositoryContract {
  static verify(createRepositories: RepositoriesFactory): void {
    it('UC-04 확장 작업을 만들면 첫 페이지부터 읽는 진행 중 상태로 저장된다', async (): Promise<void> => {
      const { expansionJobRepository, owner }: Scenario =
        await ExpansionJobRepositoryContract.scenario(createRepositories);

      await expansionJobRepository.enqueue(owner, new Date(ENQUEUED_ISO));

      expect(await expansionJobRepository.findByAlarmId(owner)).toEqual({
        kind: 'found',
        job: {
          alarmId: owner,
          enqueuedAt: new Date(ENQUEUED_ISO),
          progress: { kind: 'in-progress', cursor: { kind: 'first' } },
        },
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

        await expansionJobRepository.recordProgress(owner, progress);

        expect(await expansionJobRepository.findByAlarmId(owner)).toEqual({
          kind: 'found',
          job: { alarmId: owner, enqueuedAt: new Date(ENQUEUED_ISO), progress },
        });
      },
    );

    it('UC-07 이미 있는 확장 작업을 다시 만들어도 기존 진행 상황을 유지한다', async (): Promise<void> => {
      const { expansionJobRepository, owner }: Scenario =
        await ExpansionJobRepositoryContract.scenario(createRepositories);
      await expansionJobRepository.enqueue(owner, new Date(ENQUEUED_ISO));
      await expansionJobRepository.recordProgress(owner, {
        kind: 'in-progress',
        cursor: { kind: 'next', token: 'Mw' },
      });

      await expansionJobRepository.enqueue(owner, new Date(FINISHED_ISO));

      expect(await expansionJobRepository.findByAlarmId(owner)).toEqual({
        kind: 'found',
        job: {
          alarmId: owner,
          enqueuedAt: new Date(ENQUEUED_ISO),
          progress: { kind: 'in-progress', cursor: { kind: 'next', token: 'Mw' } },
        },
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
        await expansionJobRepository.recordProgress(owner, {
          kind: 'in-progress',
          cursor: { kind: 'next', token: 'Mw' },
        });

        await expansionJobRepository.recordProgress(owner, finished);

        expect(await expansionJobRepository.findByAlarmId(owner)).toEqual({
          kind: 'found',
          job: { alarmId: owner, enqueuedAt: new Date(ENQUEUED_ISO), progress: finished },
        });
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
        await expansionJobRepository.recordProgress(owner, finished);

        await expansionJobRepository.enqueue(owner, new Date(FINISHED_ISO));

        expect(await expansionJobRepository.findByAlarmId(owner)).toMatchObject({
          job: { progress: finished },
        });
      },
    );

    it('UC-06 조회한 완료·중단 시각을 바꿔도 저장된 값은 바뀌지 않는다', async (): Promise<void> => {
      const { expansionJobRepository, owner }: Scenario =
        await ExpansionJobRepositoryContract.scenario(createRepositories);
      await expansionJobRepository.enqueue(owner, new Date(ENQUEUED_ISO));
      await expansionJobRepository.recordProgress(owner, {
        kind: 'completed',
        completedAt: new Date(FINISHED_ISO),
      });

      const lookup: ExpansionJobLookup = await expansionJobRepository.findByAlarmId(owner);
      if (lookup.kind === 'found' && lookup.job.progress.kind === 'completed') {
        lookup.job.progress.completedAt.setUTCFullYear(1990);
      }

      expect(await expansionJobRepository.findByAlarmId(owner)).toMatchObject({
        job: { progress: { kind: 'completed', completedAt: new Date(FINISHED_ISO) } },
      });
    });

    it('UC-06 확장 작업이 없는 알림은 없음으로 돌려준다', async (): Promise<void> => {
      const { expansionJobRepository, owner }: Scenario =
        await ExpansionJobRepositoryContract.scenario(createRepositories);

      expect(await expansionJobRepository.findByAlarmId(owner)).toEqual({ kind: 'missing' });
    });

    it('UC-06 확장 작업이 없는 알림의 진행은 기록하지 않고 거부한다', async (): Promise<void> => {
      const { expansionJobRepository, owner }: Scenario =
        await ExpansionJobRepositoryContract.scenario(createRepositories);

      await expect(
        expansionJobRepository.recordProgress(owner, {
          kind: 'completed',
          completedAt: new Date(FINISHED_ISO),
        }),
      ).rejects.toBeInstanceOf(Error);
      expect(await expansionJobRepository.findByAlarmId(owner)).toEqual({ kind: 'missing' });
    });

    it('UC-06 조회한 확장 작업의 Date를 바꿔도 저장된 값은 바뀌지 않는다', async (): Promise<void> => {
      const { expansionJobRepository, owner }: Scenario =
        await ExpansionJobRepositoryContract.scenario(createRepositories);
      await expansionJobRepository.enqueue(owner, new Date(ENQUEUED_ISO));

      const lookup: ExpansionJobLookup = await expansionJobRepository.findByAlarmId(owner);
      if (lookup.kind === 'found') {
        lookup.job.enqueuedAt.setUTCFullYear(1990);
      }

      expect(await expansionJobRepository.findByAlarmId(owner)).toMatchObject({
        job: { enqueuedAt: new Date(ENQUEUED_ISO) },
      });
    });
  }

  private static async scenario(createRepositories: RepositoriesFactory): Promise<Scenario> {
    const repositories: ContractRepositories = await createRepositories();
    const id: string = randomUUID();
    if (!AlarmPredicates.isAlarmId(id)) {
      throw new Error(`generated ${id} is not a valid AlarmId`);
    }
    const creation: AlarmCreation = Alarm.create(
      id,
      { title: '추석 이벤트', body: '쿠폰 도착', kind: 'BULK', recipientIds: [] },
      new Date(ENQUEUED_ISO),
    );
    if (creation.kind !== 'created') {
      throw new Error(`contract fixture alarm is invalid: ${creation.error.code}`);
    }
    await repositories.alarmRepository.save(creation.alarm);
    return { ...repositories, owner: id };
  }
}
