import { INestApplication, Logger } from '@nestjs/common';
import { ShutdownService } from '@/bootstrap/lifecycle/shutdown.service';
import { ListenAddress } from '@/bootstrap/server/listen-address.type';
import { ListenAddressResolver } from '@/bootstrap/server/listen-address.util';
import { Host, Port } from '@/shared/config/primitive.schema';
import { TypedConfigService } from '@/shared/config/typed-config.service';
import { AppLogger } from '@/shared/logging/app.logger';

export class ServerBootstrap {
  static async run(main: () => Promise<void>): Promise<void> {
    try {
      await main();
    } catch (reason) {
      const error: Error = reason instanceof Error ? reason : new Error(String(reason));
      Logger.flush();
      new Logger('Bootstrap').fatal(`failed to start: ${error.message}`, error.stack);
      process.exit(1);
    }
  }

  static async start(app: INestApplication): Promise<void> {
    app.useLogger(app.get(AppLogger));
    app.enableShutdownHooks([...ShutdownService.SIGNALS], { useProcessExit: true });

    const config: TypedConfigService = app.get(TypedConfigService);
    const host: Host = config.get('HOST');
    const port: Port = config.get('PORT');
    await app.listen(port, host);

    const logger: Logger = new Logger('Server');
    logger.log(`pid=${process.pid} listening on ${host}:${port}`);
    ListenAddressResolver.resolve(host, port, ListenAddressResolver.currentInterfaces()).forEach(
      ({ label, url }: ListenAddress): void => logger.log(`${label}: ${url}`),
    );
  }
}
