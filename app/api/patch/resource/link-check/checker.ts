import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  LINK_CHECK_PROVIDERS,
  LINK_HEALTH_POLICY
} from '~/constants/linkHealth'
import { parseResourceLink } from '~/utils/resourceLink'
import type {
  LinkCheckIdentity,
  LinkCheckProvider,
  LinkCheckReason,
  LinkCheckSnapshot
} from '~/types/api/linkHealth'

/** Server-only transient input; never serialize it into a public response. */
export interface PreparedLinkCheckInput {
  provider: LinkCheckProvider | null
  url: string
  passcode?: string
  inputSignature: string
}

type LinkInput = { storage: string; content: string; code: string }
type Options = {
  config: { endpoint: string; apiKey: string }
  now?: () => Date
  fetch?: typeof fetch
}
type FailureReason = Exclude<LinkCheckReason, `share_${string}`>
const BODY_LIMIT = 8 * 1024
const pan123Hosts = new Set([
  '123pan.com',
  'www.123pan.com',
  '123684.com',
  'www.123684.com',
  '123865.com',
  'www.123865.com',
  '123912.com',
  'www.123912.com'
])

const recognize = (url: URL): LinkCheckProvider | null => {
  if (url.protocol !== 'https:' || url.username || url.password || url.port)
    return null
  if (
    url.hostname === 'pan.quark.cn' &&
    /^\/s\/[A-Za-z0-9]+\/?$/.test(url.pathname)
  )
    return 'quark'
  if (
    url.hostname === 'drive.uc.cn' &&
    /^\/s\/[A-Za-z0-9]+\/?$/.test(url.pathname)
  )
    return 'uc'
  if (
    url.hostname === 'pan.baidu.com' &&
    /^\/s\/1[A-Za-z0-9_-]+\/?$/.test(url.pathname)
  )
    return 'baidu'
  if (url.hostname === 'caiyun.139.com' || url.hostname === 'yun.139.com')
    return 'caiyun'
  if (
    pan123Hosts.has(url.hostname) &&
    /^\/(s|123pan)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)
  )
    return 'pan123'
  return null
}

/** This is the only provider/passcode/signature algorithm used by readers/writers. */
export const prepareLinkCheckInput = (
  link: LinkInput
): PreparedLinkCheckInput => {
  const parsed = parseResourceLink(link.content)
  let provider: LinkCheckProvider | null = null
  let preparedUrl = parsed.url
  let effectivePasscode = ''
  try {
    const url = new URL(parsed.url)
    provider = recognize(url)
    if (provider && provider !== 'caiyun') {
      // Saved extraction code wins. Only explicit extraction/access labels are
      // accepted from pasted text; an unzip-password label is never a fallback.
      effectivePasscode =
        link.code ||
        url.searchParams.get('pwd') ||
        url.searchParams.get('password') ||
        url.searchParams.get('code') ||
        link.content.match(/(?:提取码|访问码)\s*[：:]\s*([A-Za-z0-9]+)/)?.[1] ||
        ''
    }
    for (const key of ['pwd', 'password', 'code']) url.searchParams.delete(key)
    if (provider !== 'caiyun') {
      url.search = ''
      url.hash = ''
    } else if (url.hash.includes('?')) {
      const index = url.hash.indexOf('?')
      const params = new URLSearchParams(url.hash.slice(index + 1))
      for (const key of ['pwd', 'password', 'code']) params.delete(key)
      url.hash = url.hash.slice(0, index + 1) + params.toString()
    }
    preparedUrl = url.href
  } catch {
    /* Unsupported input remains a non-outbound preparation. */
  }
  return {
    provider,
    url: preparedUrl,
    ...(effectivePasscode ? { passcode: effectivePasscode } : {}),
    inputSignature: createHash('sha256')
      .update(
        JSON.stringify([
          link.storage,
          link.content,
          provider,
          effectivePasscode
        ])
      )
      .digest('hex')
  }
}

const endpointUrl = (endpoint: string) => {
  const url = new URL(endpoint)
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['/', '/v1/check'].includes(url.pathname) ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
  )
    throw new CheckFailure('unavailable')
  url.pathname = '/v1/check'
  return url.href
}

const wireSchema = z
  .object({
    provider: z.enum([...LINK_CHECK_PROVIDERS, 'unknown']),
    status: z.enum(['alive', 'dead', 'unknown']),
    reason: z.string().min(1).max(64),
    providerCode: z.string().max(32).optional(),
    checkedAt: z
      .string()
      .datetime({ offset: true })
      .regex(/(?:Z|[+-]\d{2}:\d{2})$/),
    cached: z.boolean()
  })
  .strict()
type Wire = z.infer<typeof wireSchema>

class CheckFailure extends Error {
  constructor(readonly reason: FailureReason) {
    super('Link checker failed')
  }
}

// The wire contract is flat. Tokenize quoted strings once so escaped duplicate
// member names cannot be hidden by JSON.parse's last-value behavior.
const decodeWire = (text: string) => {
  const keys = new Set<string>()
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '"') continue
    const start = i
    i += 1
    while (i < text.length && text[i] !== '"') {
      if (text[i] === '\\') i += 1
      i += 1
    }
    let after = i + 1
    while (/\s/.test(text[after] ?? '') && after < text.length) after += 1
    if (text[after] === ':') {
      const key: unknown = JSON.parse(text.slice(start, i + 1))
      if (typeof key !== 'string' || keys.has(key))
        throw new CheckFailure('invalid_response')
      keys.add(key)
    }
  }
  const decoded = wireSchema.safeParse(JSON.parse(text))
  if (!decoded.success) throw new CheckFailure('invalid_response')
  return decoded.data
}

const readWire = async (response: Response, signal: AbortSignal) => {
  const length = response.headers.get('content-length')
  if (
    length !== null &&
    (!/^\d+$/.test(length) || Number(length) > BODY_LIMIT)
  ) {
    void response.body?.cancel().catch(() => {})
    throw new CheckFailure('invalid_response')
  }
  if (!response.body) throw new CheckFailure('invalid_response')
  const reader = response.body.getReader()
  const cancel = () => {
    void reader.cancel().catch(() => {})
  }
  signal.addEventListener('abort', cancel, { once: true })
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > BODY_LIMIT) {
        cancel()
        throw new CheckFailure('invalid_response')
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    try {
      return decodeWire(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    } catch {
      throw new CheckFailure('invalid_response')
    }
  } finally {
    signal.removeEventListener('abort', cancel)
    reader.releaseLock()
  }
}

const mapObservation = (wire: Wire) => {
  const code = wire.providerCode ?? ''
  if (wire.status === 'alive' && wire.reason === 'share_ok' && code === '0')
    return { verdict: 'available' as const, reason: 'share_available' as const }
  if (wire.status === 'dead') {
    if (wire.reason === 'share_not_found' && ['41004', '41006'].includes(code))
      return { verdict: 'broken' as const, reason: 'share_deleted' as const }
    if (wire.reason === 'share_not_found' && code === '41012')
      return { verdict: 'broken' as const, reason: 'share_cancelled' as const }
    if (wire.reason === 'share_expired' && code === '41011')
      return { verdict: 'broken' as const, reason: 'share_expired' as const }
  }
  if (wire.status === 'unknown') {
    if (
      (wire.reason === 'share_blocked' &&
        ['41010', '41031', '0/partial_violation'].includes(code)) ||
      (wire.reason === 'passcode_required' && code === '41008')
    ) {
      return {
        verdict: 'unknown' as const,
        reason: 'access_unverified' as const
      }
    }
    if (code === '') {
      const failures: Record<string, FailureReason> = {
        unsupported_provider: 'unsupported',
        rate_limited: 'rate_limited',
        timeout: 'timeout',
        network_error: 'unavailable',
        unparseable_response: 'invalid_response',
        captcha_required: 'access_unverified',
        login_required: 'access_unverified'
      }
      if (Object.hasOwn(failures, wire.reason))
        throw new CheckFailure(failures[wire.reason])
    }
    if (wire.reason === 'unparseable_response' && code === '0')
      throw new CheckFailure('invalid_response')
  }
  throw new CheckFailure('untrusted_result')
}

/** Single trusted service call. Failures are facts, never business exceptions. */
export const checkLink = async (
  identity: LinkCheckIdentity,
  prepared: PreparedLinkCheckInput,
  options: Options
): Promise<LinkCheckSnapshot> => {
  const captured = { ...identity, basis: { ...identity.basis } }
  const clock = options.now ?? (() => new Date())
  const requested = Date.parse(captured.requestedAt)
  let cached = false
  const failed = (reason: FailureReason): LinkCheckSnapshot => ({
    ...captured,
    completedAt: clock().toISOString(),
    cached,
    verdict: 'unknown',
    provider: prepared.provider,
    reason,
    failed: true,
    checkedAt: null
  })
  if (
    captured.inputSignature !== prepared.inputSignature ||
    !Number.isFinite(requested)
  )
    return failed('untrusted_result')
  if (prepared.provider !== 'quark') return failed('unsupported')
  const elapsed = clock().getTime() - requested
  if (elapsed < 0) return failed('untrusted_result')
  if (elapsed >= LINK_HEALTH_POLICY.checkBudgetMs) return failed('timeout')
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    if (
      recognize(new URL(prepared.url)) !== 'quark' ||
      typeof options.config.apiKey !== 'string' ||
      !options.config.apiKey ||
      /\s/.test(options.config.apiKey) ||
      (prepared.passcode !== undefined &&
        (typeof prepared.passcode !== 'string' ||
          prepared.passcode.length > 1007))
    )
      throw new CheckFailure('unavailable')
    const endpoint = endpointUrl(options.config.endpoint)
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new CheckFailure('timeout'))
      }, LINK_HEALTH_POLICY.checkBudgetMs - elapsed)
    })
    const work = async () => {
      const response = await (options.fetch ?? globalThis.fetch)(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${options.config.apiKey}`
        },
        body: JSON.stringify({
          url: prepared.url,
          ...(prepared.passcode ? { passcode: prepared.passcode } : {})
        }),
        signal: controller.signal,
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store'
      })
      if (
        response.redirected ||
        response.type === 'opaqueredirect' ||
        (response.status >= 300 && response.status < 400) ||
        (response.url && response.url !== endpoint)
      ) {
        void response.body?.cancel().catch(() => {})
        throw new CheckFailure('untrusted_result')
      }
      if (response.status !== 200) {
        void response.body?.cancel().catch(() => {})
        throw new CheckFailure(
          response.status === 429 ? 'rate_limited' : 'unavailable'
        )
      }
      return readWire(response, controller.signal)
    }
    const wire = await Promise.race([work(), deadline])
    cached = wire.cached
    const completed = clock()
    const checked = Date.parse(wire.checkedAt)
    const basisTime =
      captured.basis.healthChangedAt === null
        ? null
        : Date.parse(captured.basis.healthChangedAt)
    if (completed.getTime() - requested > LINK_HEALTH_POLICY.checkBudgetMs)
      throw new CheckFailure('timeout')
    if (
      wire.provider !== 'quark' ||
      cached ||
      !Number.isFinite(checked) ||
      checked < requested - LINK_HEALTH_POLICY.checkClockSkewMs ||
      checked > completed.getTime() + LINK_HEALTH_POLICY.checkClockSkewMs ||
      (basisTime !== null &&
        (!Number.isFinite(basisTime) || checked < basisTime))
    )
      throw new CheckFailure('untrusted_result')
    const observation = mapObservation(wire)
    return {
      ...captured,
      ...observation,
      provider: 'quark',
      failed: false,
      checkedAt: new Date(checked).toISOString(),
      completedAt: completed.toISOString(),
      cached: false
    }
  } catch (error) {
    return failed(
      controller.signal.aborted
        ? 'timeout'
        : error instanceof CheckFailure
          ? error.reason
          : 'unavailable'
    )
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
