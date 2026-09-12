export const SHOUTBOX_READ_UNAVAILABLE_MESSAGE = '小喇叭暂时不可用，请稍后重试'

export type ShoutboxReadScope = 'global' | 'patch'

export class ShoutboxReadError extends Error {
  readonly retryAfterSeconds: number

  constructor(readonly scope: ShoutboxReadScope) {
    super(SHOUTBOX_READ_UNAVAILABLE_MESSAGE)
    this.name = 'ShoutboxReadError'
    this.retryAfterSeconds = scope === 'patch' ? 300 : 60
  }
}

export const toShoutboxReadError = (
  error: unknown,
  scope: ShoutboxReadScope
) => (error instanceof ShoutboxReadError ? error : new ShoutboxReadError(scope))
