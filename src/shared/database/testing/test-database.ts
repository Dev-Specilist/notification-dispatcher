import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { inject } from 'vitest';

export class TestDatabase {
  static readonly TEMPLATE_NAME: string = 'notification_template';

  private constructor(
    private readonly adminUri: string,
    private readonly name: string,
    readonly pool: Pool,
  ) {}

  static async create(): Promise<TestDatabase> {
    const adminUri: string = inject('postgresAdminUri');
    const name: string = `test_${randomUUID().replaceAll('-', '')}`;
    await TestDatabase.runAsAdmin(
      adminUri,
      `CREATE DATABASE "${name}" TEMPLATE "${TestDatabase.TEMPLATE_NAME}"`,
    );
    return new TestDatabase(
      adminUri,
      name,
      new Pool({ connectionString: TestDatabase.uriFor(adminUri, name) }),
    );
  }

  static uriFor(adminUri: string, databaseName: string): string {
    const uri: URL = new URL(adminUri);
    uri.pathname = `/${databaseName}`;
    return uri.toString();
  }

  static async runAsAdmin(adminUri: string, statement: string): Promise<void> {
    const client: Client = new Client({ connectionString: adminUri });
    await client.connect();
    try {
      await client.query(statement);
    } finally {
      await client.end();
    }
  }

  async drop(): Promise<void> {
    await this.pool.end();
    await TestDatabase.runAsAdmin(this.adminUri, `DROP DATABASE "${this.name}"`);
  }
}
