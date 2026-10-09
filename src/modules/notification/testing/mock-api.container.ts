import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';

export interface MockApiEnvironment {
  readonly RATE_LIMIT: string;
  readonly ERROR_RATE: string;
  readonly TIMEOUT_RATE: string;
  readonly TIMEOUT_MS: string;
  readonly SLOW_RATE: string;
  readonly SLOW_MS: string;
  readonly BLOCKED_PERCENT: string;
  readonly USER_COUNT: string;
}

export class MockApiContainer {
  static readonly IMAGE: string = 'ghcr.io/us-all/backend-assignment-api:1.2';

  private static readonly PORT: number = 4000;

  private static readonly DETERMINISTIC: MockApiEnvironment = {
    RATE_LIMIT: '1000',
    ERROR_RATE: '0',
    TIMEOUT_RATE: '0',
    TIMEOUT_MS: '30000',
    SLOW_RATE: '0',
    SLOW_MS: '3000',
    BLOCKED_PERCENT: '0',
    USER_COUNT: '100',
  };

  private constructor(
    private readonly container: StartedTestContainer,
    readonly baseUrl: URL,
  ) {}

  static async start(overrides: Readonly<Partial<MockApiEnvironment>>): Promise<MockApiContainer> {
    const environment: MockApiEnvironment = { ...MockApiContainer.DETERMINISTIC, ...overrides };
    const container: StartedTestContainer = await new GenericContainer(MockApiContainer.IMAGE)
      .withEnvironment({ ...environment })
      .withExposedPorts(MockApiContainer.PORT)
      .withWaitStrategy(Wait.forHttp('/health', MockApiContainer.PORT))
      .start();
    return new MockApiContainer(
      container,
      new URL(`http://${container.getHost()}:${container.getMappedPort(MockApiContainer.PORT)}`),
    );
  }

  async stop(): Promise<void> {
    await this.container.stop();
  }
}
