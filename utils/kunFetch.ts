type FetchOptions = {
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

const createKunFetchStatusError = (status: number, body: unknown) => {
  const bodyMessage = getKunFetchErrorBodyMessage(body)
  return new Error(
    bodyMessage
      ? `Kun Fetch error! Status: ${status}; Message: ${bodyMessage}`
      : `Kun Fetch error! Status: ${status}`
  )
}

const kunFetchRequest = async <T>(
  url: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
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
      preserveErrorStatus
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

    let timeoutId: NodeJS.Timeout | number | undefined

    if (timeout) {
      const controller = new AbortController()
      timeoutId = setTimeout(() => controller.abort(), timeout)
      fetchOptions.signal = controller.signal
    }

    try {
      const response = await fetch(fullUrl, fetchOptions)
      const res = await parseKunFetchResponseBody(response)

      if (!response.ok) {
        if (preserveErrorStatus) {
          throw createKunFetchStatusError(response.status, res)
        }

        if (typeof res === 'string') {
          return res as T
        }

        throw createKunFetchStatusError(response.status, res)
      }

      return res as T
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  } catch (error) {
    console.error(`Kun Fetch error: ${error}`)
    throw error
  }
}

export const kunFetchGet = async <T>(
  url: string,
  query?: Record<string, string | number>,
  options?: Pick<FetchOptions, 'timeout'>
): Promise<T> => {
  return kunFetchRequest<T>(url, 'GET', { query, ...options })
}

export const kunFetchPost = async <T>(
  url: string,
  body?: Record<string, unknown>
): Promise<T> => {
  return kunFetchRequest<T>(url, 'POST', { body })
}

export const kunFetchPut = async <T>(
  url: string,
  body?: Record<string, unknown>,
  options?: Pick<FetchOptions, 'keepalive'>
): Promise<T> => {
  return kunFetchRequest<T>(url, 'PUT', { body, ...options })
}

export const kunFetchDelete = async <T>(
  url: string,
  query?: Record<string, string | number>
): Promise<T> => {
  return kunFetchRequest<T>(url, 'DELETE', { query })
}

export const kunFetchFormData = async <T>(
  url: string,
  formData?: FormData,
  timeout?: number,
  options?: Pick<FetchOptions, 'preserveErrorStatus'>
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
