import { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import { ListenAddress, NetworkInterfaceMap } from '@/bootstrap/server/listen-address.type';
import { ListenAddressResolver } from '@/bootstrap/server/listen-address.util';
import { hostSchema, portSchema } from '@/shared/config/primitive.schema';

const ipv4 = (address: string, internal: boolean): Readonly<NetworkInterfaceInfo> => ({
  address,
  netmask: '255.255.0.0',
  family: 'IPv4',
  mac: '00:00:00:00:00:00',
  internal,
  cidr: `${address}/16`,
});

const ipv6 = (address: string): Readonly<NetworkInterfaceInfo> => ({
  address,
  netmask: 'ffff:ffff:ffff:ffff::',
  family: 'IPv6',
  mac: '00:00:00:00:00:00',
  internal: false,
  cidr: `${address}/64`,
  scopeid: 0,
});

describe('ListenAddressResolver.resolve', () => {
  const interfaces: NetworkInterfaceMap = {
    lo: [ipv4('127.0.0.1', true)],
    eth0: [ipv4('172.18.0.3', false), ipv6('fe80::1')],
    eth1: [],
  };

  it('모든 인터페이스에 바인딩하면 Local과 외부 IPv4 인터페이스 주소를 모두 나열한다', () => {
    const addresses: ReadonlyArray<ListenAddress> = ListenAddressResolver.resolve(
      hostSchema.parse('0.0.0.0'),
      portSchema.parse(3000),
      interfaces,
    );

    expect(addresses).toEqual([
      { label: 'Local', url: 'http://localhost:3000' },
      { label: 'Network (eth0)', url: 'http://172.18.0.3:3000' },
    ]);
  });

  it('특정 주소에 바인딩하면 그 주소만 나열한다', () => {
    const addresses: ReadonlyArray<ListenAddress> = ListenAddressResolver.resolve(
      hostSchema.parse('127.0.0.1'),
      portSchema.parse(8080),
      interfaces,
    );

    expect(addresses).toEqual([{ label: 'Bound', url: 'http://127.0.0.1:8080' }]);
  });

  it('IPv6 호스트는 대괄호로 감싼다', () => {
    const addresses: ReadonlyArray<ListenAddress> = ListenAddressResolver.resolve(
      hostSchema.parse('::1'),
      portSchema.parse(8080),
      interfaces,
    );

    expect(addresses).toEqual([{ label: 'Bound', url: 'http://[::1]:8080' }]);
  });
});

describe('ListenAddressResolver.toInterfaceMap', () => {
  it('OS가 돌려준 인터페이스 목록을 인터페이스 이름별 맵으로 바꾼다', () => {
    const map: NetworkInterfaceMap = ListenAddressResolver.toInterfaceMap({
      lo: [ipv4('127.0.0.1', true)],
      eth0: [ipv4('172.18.0.3', false)],
    });

    expect(map).toEqual({
      lo: [ipv4('127.0.0.1', true)],
      eth0: [ipv4('172.18.0.3', false)],
    });
  });
});
