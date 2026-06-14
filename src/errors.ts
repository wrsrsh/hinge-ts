export type HingeErrorKind =
  | "http"
  | "auth"
  | "email_2fa"
  | "storage"
  | "serde"
  | "network"
  | "unsupported_runtime";

export class HingeError extends Error {
  readonly kind: HingeErrorKind;
  readonly status: number | undefined;
  readonly cause: unknown;

  constructor(kind: HingeErrorKind, message: string, options: { status?: number; cause?: unknown } = {}) {
    super(`${kind}: ${message}`);
    this.name = "HingeError";
    this.kind = kind;
    this.status = options.status;
    this.cause = options.cause;
  }
}

export class Email2FAError extends HingeError {
  readonly caseId: string;
  readonly email: string;

  constructor(caseId: string, email: string) {
    super("email_2fa", `email_2fa required: case_id=${caseId} email=${email}`);
    this.name = "Email2FAError";
    this.caseId = caseId;
    this.email = email;
  }
}

export function isHingeError(error: unknown): error is HingeError {
  return error instanceof HingeError;
}

export function toHingeError(kind: HingeErrorKind, message: string, cause?: unknown): HingeError {
  return cause instanceof HingeError ? cause : new HingeError(kind, message, { cause });
}
