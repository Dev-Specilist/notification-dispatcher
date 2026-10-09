import { inspect } from 'node:util';

export interface KindCarrier {
  readonly kind: string;
}

export type KindMember<TUnion extends KindCarrier, TKind extends TUnion['kind']> = Extract<
  TUnion,
  Readonly<Record<'kind', TKind>>
>;

export class KindAssertion {
  static assertKind<TUnion extends KindCarrier, TKind extends TUnion['kind']>(
    value: TUnion,
    expectedKind: TKind,
  ): asserts value is KindMember<TUnion, TKind> {
    if (value.kind !== expectedKind) {
      throw new Error(
        `expected kind '${expectedKind}' but got '${value.kind}': ${inspect(value, { depth: 4 })}`,
      );
    }
  }
}
