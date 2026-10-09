import { INestApplication, Logger } from '@nestjs/common';
import { ShutdownService } from '@/bootstrap/lifecycle/shutdown.service';
import { ListenAddress } from '@/bootstrap/server/listen-address.type';
import { ListenAddressResolver } from '@/bootstrap/server/listen-address.util';
import { Host, Port } from '@/shared/config/primitive.type';
import { TypedConfigService } from '@/shared/config/typed-config.service';
import { ThrownValues } from '@/shared/error/thrown-value.util';
import { AppLogger } from '@/shared/logging/app.logger';

export class ServerBootstrap {
  private static readonly logger: Logger = new Logger(ServerBootstrap.name);

  static async run(main: () => Promise<void>): Promise<void> {
    try {
      await main();
    } catch (error) {
      const { message, stack }: Error = ThrownValues.toError(error);
      Logger.flush();
      ServerBootstrap.logger.fatal(`failed to start: ${message}`, stack);
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

    ServerBootstrap.logger.log(`pid=${process.pid} listening on ${host}:${port}`);
    ListenAddressResolver.resolve(host, port, ListenAddressResolver.currentInterfaces()).forEach(
      ({ label, url }: ListenAddress): void => ServerBootstrap.logger.log(`${label}: ${url}`),
    );
  }
}
