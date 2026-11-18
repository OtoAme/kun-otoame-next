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

export type ConversationErrorResponse = {
  kind: 'conversation-error'
  status: 400 | 403 | 404
  code: string
  message: string
}

export const conversationError = (
  status: ConversationErrorResponse['status'],
  code: string,
  message: string
): ConversationErrorResponse => ({
  kind: 'conversation-error',
  status,
  code,
  message
})

export const isConversationError = (
  value: unknown
): value is ConversationErrorResponse =>
  !!value &&
  typeof value === 'object' &&
  'kind' in value &&
  value.kind === 'conversation-error'
