export type ConversationRateLimitResponse = {
  kind: 'conversation-rate-limit'
  message: string
  retryAfterMs: number
}

export const createConversationRateLimitResponse = (
  message: string,
  retryAfterMs: number
): ConversationRateLimitResponse => ({
  kind: 'conversation-rate-limit',
  message,
  retryAfterMs
})

export const isConversationRateLimitResponse = (
  value: unknown
): value is ConversationRateLimitResponse =>
  Boolean(
    value &&
      typeof value === 'object' &&
      (value as { kind?: unknown }).kind === 'conversation-rate-limit' &&
      typeof (value as { message?: unknown }).message === 'string' &&
      typeof (value as { retryAfterMs?: unknown }).retryAfterMs === 'number'
  )

export const getConversationRetryAfterSeconds = (retryAfterMs: number) =>
  String(Math.max(1, Math.ceil(retryAfterMs / 1000)))
