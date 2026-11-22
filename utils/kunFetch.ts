export type FetchOptions = {
  signal?: AbortSignal
  headers?: Record<string, string>
  query?: Record<string, string | number>
  body?: Record<string, unknown>
  formData?: FormData
  timeout?: number
  keepalive?: boolean
  preserveErrorStatus?: boolean
}

const parseKunFetchResponseBody = async (response: Response) => {
  const text = await response.text()
  if (!text) {
    return undefined
  }

  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

const getKunFetchErrorBodyMessage = (body: unknown) => {
  if (typeof body === 'string') {
    return body.replace(/\s+/g, ' ').trim()
  }

  if (!body || typeof body !== 'object') {
    return ''
  }

  const record = body as Record<string, unknown>
  const candidateKeys = ['message', 'error', 'reason', 'detail']
  for (const key of candidateKeys) {
    const value = record[key]
    if (typeof value === 'string') {
      const message = value.replace(/\s+/g, ' ').trim()
      if (message) {
        return message
      }
    }
  }

  return ''
}

export type KunFetchErrorKind = 'http' | 'network' | 'timeout' | 'aborted'

export class KunFetchError extends Error {
  readonly name = 'KunFetchError'
  declare readonly body: unknown
  constructor(
    message: string,
    readonly kind: KunFetchErrorKind,
    readonly status: number | null = null,
    readonly retryAfterMs: number | null = null,
    readonly code: string | null = null,
    body: unknown = undefined
  ) {
    super(message)
    Object.defineProperty(this, 'body', { value: body, enumerable: false })
  }
}

export const parseRetryAfter = (value: string | null, now = Date.now()) => {
  if (!value?.trim()) return null
  if (/^\d+(?:\.\d+)?$/.test(value.trim())) {
    const delay = Number(value) * 1000
    return Number.isFinite(delay) ? delay : null
  }
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - now) : null
}

const createKunFetchStatusError = (response: Response, body: unknown) => {
  const status = response.status
  const bodyMessage = getKunFetchErrorBodyMessage(body)
  return new KunFetchError(
    bodyMessage
      ? `Kun Fetch error! Status: ${status}; Message: ${bodyMessage}`
      : `Kun Fetch error! Status: ${status}`,
    'http',
    status,
    parseRetryAfter(response.headers.get('Retry-After')),
    body &&
    typeof body === 'object' &&
    'code' in body &&
    typeof body.code === 'string'
      ? body.code
      : null,
    body
  )
}

const isKunFetchAbortError = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'name' in error &&
  error.name === 'AbortError'

const kunFetchRequest = async <T>(
  url: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  options?: FetchOptions
): Promise<T> => {
  try {
    const {
      headers = {},
      query,
      body,
      formData,
      timeout,
      keepalive,
      preserveErrorStatus,
      signal
    } = options || {}

    const queryString = query
      ? '?' +
        new URLSearchParams(
          Object.entries(query).map(([key, value]) => [key, String(value)])
        ).toString()
      : ''

    const isClient = typeof window !== 'undefined'
    const envAddress =
      process.env.NODE_ENV === 'development'
        ? process.env.NEXT_PUBLIC_KUN_PATCH_ADDRESS_DEV
        : process.env.NEXT_PUBLIC_KUN_PATCH_ADDRESS_PROD

    const fetchAddress = isClient ? '' : envAddress
    const fullUrl = `${fetchAddress}/api${url}${queryString}`

    const fetchOptions: RequestInit = {
      method,
      credentials: 'include',
      mode: 'cors',
      headers: {
        'X-Requested-With': 'kun-fetch',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers
      },
      keepalive
    }

    if (formData) {
      fetchOptions.body = formData
    } else if (body) {
      fetchOptions.body = JSON.stringify(body)
    }

    let receivedResponse: Response | undefined
    const controller = new AbortController()
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const abortState: { kind: 'timeout' | 'aborted' } = { kind: 'aborted' }
    const onCallerAbort = () => controller.abort()
    let onAbort: () => void = () => {}
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () =>
        reject(
          new KunFetchError(
            abortState.kind === 'timeout'
              ? 'Kun Fetch request timed out'
              : 'Kun Fetch request cancelled',
            abortState.kind,
            receivedResponse?.status ?? null,
            receivedResponse
              ? parseRetryAfter(receivedResponse.headers.get('Retry-After'))
              : null
          )
        )
      controller.signal.addEventListener('abort', onAbort, { once: true })
    })
    signal?.addEventListener('abort', onCallerAbort, { once: true })
    if (signal?.aborted) controller.abort()
    if (timeout && timeout > 0) {
      timeoutId = setTimeout(() => {
        abortState.kind = 'timeout'
        controller.abort()
      }, timeout)
    }
    fetchOptions.signal = controller.signal

    try {
      return await Promise.race([
        aborted,
        (async () => {
          if (controller.signal.aborted) return await aborted
          const response = await fetch(fullUrl, fetchOptions)
          receivedResponse = response
          const res = await parseKunFetchResponseBody(response)
          if (!response.ok) {
            if (!preserveErrorStatus && typeof res === 'string') return res as T
            throw createKunFetchStatusError(response, res)
          }
          return res as T
        })()
      ])
    } catch (error) {
      if (controller.signal.aborted) {
        throw new KunFetchError(
          abortState.kind === 'timeout'
            ? 'Kun Fetch request timed out'
            : 'Kun Fetch request cancelled',
          abortState.kind,
          receivedResponse?.status ?? null,
          receivedResponse
            ? parseRetryAfter(receivedResponse.headers.get('Retry-After'))
            : null
        )
      }
      if (preserveErrorStatus && isKunFetchAbortError(error)) {
        throw new KunFetchError('Kun Fetch request cancelled', 'aborted')
      }
      if (
        receivedResponse &&
        !receivedResponse.ok &&
        !(error instanceof KunFetchError)
      ) {
        throw createKunFetchStatusError(receivedResponse, undefined)
      }
      if (preserveErrorStatus && !(error instanceof KunFetchError)) {
        throw new KunFetchError('Kun Fetch network request failed', 'network')
      }
      throw error
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId)
      signal?.removeEventListener('abort', onCallerAbort)
      controller.signal.removeEventListener('abort', onAbort)
    }
  } catch (error) {
    if (
      !isKunFetchAbortError(error) &&
      !(error instanceof KunFetchError && error.kind === 'aborted')
    ) {
      console.error(
        error instanceof KunFetchError
          ? `Kun Fetch error: ${error.kind}; status: ${error.status}`
          : 'Kun Fetch request failed'
      )
    }
    throw error
  }
}

export const kunFetchGet = async <T>(
  url: string,
  query?: Record<string, string | number>,
  options?: Pick<
    FetchOptions,
    'timeout' | 'signal' | 'preserveErrorStatus' | 'headers'
  >
): Promise<T> => {
  return kunFetchRequest<T>(url, 'GET', { query, ...options })
}

export const kunFetchPost = async <T>(
  url: string,
  body?: Record<string, unknown>,
  options?: Pick<
    FetchOptions,
    'timeout' | 'signal' | 'preserveErrorStatus' | 'headers'
  >
): Promise<T> => {
  return kunFetchRequest<T>(url, 'POST', { body, ...options })
}

export const kunFetchPut = async <T>(
  url: string,
  body?: Record<string, unknown>,
  options?: Pick<
    FetchOptions,
    'keepalive' | 'timeout' | 'signal' | 'preserveErrorStatus' | 'headers'
  >
): Promise<T> => {
  return kunFetchRequest<T>(url, 'PUT', { body, ...options })
}

export const kunFetchPatch = async <T>(
  url: string,
  body?: Record<string, unknown>
): Promise<T> => {
  return kunFetchRequest<T>(url, 'PATCH', { body })
}

export const kunFetchDelete = async <T>(
  url: string,
  query?: Record<string, string | number>,
  options?: Pick<
    FetchOptions,
    'timeout' | 'signal' | 'preserveErrorStatus' | 'headers'
  >
): Promise<T> => {
  return kunFetchRequest<T>(url, 'DELETE', { query, ...options })
}

export const kunFetchDeleteBody = async <T>(
  url: string,
  body?: Record<string, unknown>
): Promise<T> => {
  return kunFetchRequest<T>(url, 'DELETE', { body })
}

export const kunFetchFormData = async <T>(
  url: string,
  formData?: FormData,
  timeout?: number,
  options?: Pick<FetchOptions, 'preserveErrorStatus' | 'headers'>
): Promise<T> => {
  if (!formData) {
    throw new Error('formData is required for kunFetchFormData')
  }
  return kunFetchRequest<T>(url, 'POST', { formData, timeout, ...options })
}

export const kunFetchPutFormData = async <T>(
  url: string,
  formData?: FormData,
  timeout?: number
): Promise<T> => {
  if (!formData) {
    throw new Error('formData is required for kunFetchPutFormData')
  }
  return kunFetchRequest<T>(url, 'PUT', { formData, timeout })
}
