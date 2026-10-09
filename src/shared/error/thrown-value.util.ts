export class ThrownValues {
  static toError<TThrown>(thrown: TThrown): Extract<TThrown, Error> | Error {
    return thrown instanceof Error ? thrown : new Error(String(thrown));
  }
}
