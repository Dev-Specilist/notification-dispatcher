import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';

export interface StubResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

type StubHandler = (response: ServerResponse) => void;

const NOT_YET_SIGNALED: () => void = (): void => {};

export class StubHttpServer {
  private static readonly STREAM_CHUNK_INTERVAL_MS: number = 10;

  private constructor(
    private readonly server: Server,
    readonly baseUrl: URL,
    readonly requestReceived: Promise<void>,
    readonly responseClosed: Promise<void>,
  ) {}

  static respondingWith(stub: Readonly<StubResponse>): Promise<StubHttpServer> {
    return StubHttpServer.start((response: ServerResponse): void => {
      response.writeHead(stub.status, { ...stub.headers });
      response.end(stub.body);
    });
  }

  static streamingEndlessly(status: number): Promise<StubHttpServer> {
    return StubHttpServer.start((response: ServerResponse): void => {
      response.writeHead(status, { 'content-type': 'application/json' });
      const streaming: NodeJS.Timeout = setInterval((): void => {
        response.write(' ');
      }, StubHttpServer.STREAM_CHUNK_INTERVAL_MS);
      response.on('close', (): void => clearInterval(streaming));
    });
  }

  static neverResponding(): Promise<StubHttpServer> {
    return StubHttpServer.start((_response: ServerResponse): void => {});
  }

  static droppingConnection(): Promise<StubHttpServer> {
    return StubHttpServer.start((response: ServerResponse): void => {
      response.destroy();
    });
  }

  close(): Promise<void> {
    this.server.closeAllConnections();
    return new Promise<void>((resolve: () => void, reject: (error: Error) => void): void => {
      this.server.close((error?: Error): void =>
        error instanceof Error ? reject(error) : resolve(),
      );
    });
  }

  private static async start(handle: StubHandler): Promise<StubHttpServer> {
    let markReceived: () => void = NOT_YET_SIGNALED;
    const requestReceived: Promise<void> = new Promise<void>((resolve: () => void): void => {
      markReceived = resolve;
    });
    let markClosed: () => void = NOT_YET_SIGNALED;
    const responseClosed: Promise<void> = new Promise<void>((resolve: () => void): void => {
      markClosed = resolve;
    });
    const server: Server = createServer(
      (_request: IncomingMessage, response: ServerResponse): void => {
        response.on('close', markClosed);
        markReceived();
        handle(response);
      },
    );
    await new Promise<void>((resolve: () => void): void => {
      server.listen(0, '127.0.0.1', resolve);
    });
    return new StubHttpServer(
      server,
      StubHttpServer.urlOf(server.address()),
      requestReceived,
      responseClosed,
    );
  }

  private static urlOf(address: ReturnType<Server['address']>): URL {
    if (!(address instanceof Object) || typeof address === 'string') {
      throw new Error('stub server is not listening on a TCP port');
    }
    const { address: host, port }: AddressInfo = address;
    return new URL(`http://${host}:${port}`);
  }
}
