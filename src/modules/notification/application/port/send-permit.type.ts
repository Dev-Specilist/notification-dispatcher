export interface PermitGranted {
  readonly kind: 'granted';
}

export interface PermitDenied {
  readonly kind: 'denied';
}

export type SendPermit = PermitGranted | PermitDenied;
