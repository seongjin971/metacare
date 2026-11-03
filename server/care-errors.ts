export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

/** The push provider explicitly refused the request before accepting any message. */
export class RetryablePushError extends Error {}
