import { NetworkInterfaceInfo, networkInterfaces } from 'node:os';

export type InterfaceName = string;

export type ListenUrl = `http://${string}:${number}`;

export type ListenAddressLabel = 'Local' | 'Bound' | `Network (${InterfaceName})`;

export interface ListenAddress {
  readonly label: ListenAddressLabel;
  readonly url: ListenUrl;
}

export type NetworkInterfaceMap = Readonly<
  Record<InterfaceName, ReadonlyArray<NetworkInterfaceInfo>>
>;

export type OsNetworkInterfaces = ReturnType<typeof networkInterfaces>;

export type OsInterfaceInfos = OsNetworkInterfaces[InterfaceName];

export type PresentOsInterfaceInfos = NonNullable<OsInterfaceInfos>;

export type OsInterfaceEntry = Readonly<[InterfaceName, OsInterfaceInfos]>;

export type InterfaceEntry = Readonly<[InterfaceName, ReadonlyArray<NetworkInterfaceInfo>]>;
