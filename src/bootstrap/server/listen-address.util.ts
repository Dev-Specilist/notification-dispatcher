import { NetworkInterfaceInfo, networkInterfaces } from 'node:os';
import {
  InterfaceEntry,
  ListenAddress,
  ListenUrl,
  NetworkInterfaceMap,
  OsInterfaceEntry,
  OsInterfaceInfos,
  OsNetworkInterfaces,
  PresentOsInterfaceInfos,
} from '@/bootstrap/server/listen-address.type';
import { Host, Port } from '@/shared/config/primitive.type';

export class ListenAddressResolver {
  private static readonly ALL_INTERFACES: ReadonlySet<string> = new Set<string>(['0.0.0.0', '::']);

  static currentInterfaces(): NetworkInterfaceMap {
    return ListenAddressResolver.toInterfaceMap(networkInterfaces());
  }

  static toInterfaceMap(raw: Readonly<OsNetworkInterfaces>): NetworkInterfaceMap {
    return Object.fromEntries(
      Object.entries(raw).flatMap(
        ([name, infos]: OsInterfaceEntry): ReadonlyArray<InterfaceEntry> =>
          ListenAddressResolver.isPresent(infos) ? [[name, infos]] : [],
      ),
    );
  }

  static resolve(
    host: Host,
    port: Port,
    interfaces: NetworkInterfaceMap,
  ): ReadonlyArray<ListenAddress> {
    if (!ListenAddressResolver.ALL_INTERFACES.has(host)) {
      return [{ label: 'Bound', url: ListenAddressResolver.toUrl(host, port) }];
    }

    const network: ReadonlyArray<ListenAddress> = Object.entries(interfaces).flatMap(
      ([name, infos]: InterfaceEntry): ReadonlyArray<ListenAddress> =>
        infos
          .filter((info: Readonly<NetworkInterfaceInfo>): boolean =>
            ListenAddressResolver.isExternalIpv4(info),
          )
          .map(({ address }: Readonly<NetworkInterfaceInfo>): ListenAddress => ({
            label: `Network (${name})`,
            url: ListenAddressResolver.toUrl(address, port),
          })),
    );

    return [{ label: 'Local', url: ListenAddressResolver.toUrl('localhost', port) }, ...network];
  }

  private static isPresent(infos: OsInterfaceInfos): infos is PresentOsInterfaceInfos {
    return Array.isArray(infos);
  }

  private static toUrl(host: string, port: Port): ListenUrl {
    const formattedHost: string = host.includes(':') ? `[${host}]` : host;
    return `http://${formattedHost}:${port}`;
  }

  private static isExternalIpv4({ family, internal }: Readonly<NetworkInterfaceInfo>): boolean {
    return family === 'IPv4' && !internal;
  }
}
