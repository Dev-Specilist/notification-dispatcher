export abstract class ReadinessPort {
  abstract isAcceptingTraffic(): boolean;

  abstract stopAcceptingTraffic(): void;
}
