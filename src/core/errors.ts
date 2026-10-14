/** An expected failure with a message meant for the user; printed without a stack trace. */
export class RcatError extends Error {
  readonly hint?: string;
  /** Stable machine-readable identifier (`E_…`), printed in JSON errors. */
  readonly code?: string;

  constructor(message: string, options: { hint?: string; code?: string; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'RcatError';
    this.hint = options.hint;
    this.code = options.code;
  }
}
