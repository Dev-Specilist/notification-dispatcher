export class UuidPredicates {
  private static readonly UUID: RegExp =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  static isUuid(value: string): boolean {
    return UuidPredicates.UUID.test(value);
  }
}
