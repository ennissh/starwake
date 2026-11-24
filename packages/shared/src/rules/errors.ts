/** A rule refused an action (e.g. out of range). The server turns it into a 409 with this code. */
export class RuleError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RuleError';
  }
}
