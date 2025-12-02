type FetchOptions = {
  headers?: Record<string, string>
  query?: Record<string, string | number>
  body?: Record<string, unknown>
  formData?: FormData
  timeout?: number
}

const kunFetchRequest = async <T>(
  url: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  options?: FetchOptions
): Promise<T> => {
  try {
    const { headers = {}, query, body, formData, timeout } = options || {}

    const queryString = query
      ? '?' +
      Object.entries(query)
        .map(([key, value]) => `${key}=${value}`)
        .join('&')
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
        ...headers
      }
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

      if (!response.ok) {
        throw new Error(`Kun Fetch error! Status: ${response.status}`)
      }

      const res = await response.json()

      return res
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
  query?: Record<string, string | number>
): Promise<T> => {
  return kunFetchRequest<T>(url, 'GET', { query })
}

export const kunFetchPost = async <T>(
  url: string,
  body?: Record<string, unknown>
): Promise<T> => {
  return kunFetchRequest<T>(url, 'POST', { body })
}

export const kunFetchPut = async <T>(
  url: string,
  body?: Record<string, unknown>
): Promise<T> => {
  return kunFetchRequest<T>(url, 'PUT', { body })
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
  timeout?: number
): Promise<T> => {
  if (!formData) {
    throw new Error('formData is required for kunFetchFormData')
  }
  return kunFetchRequest<T>(url, 'POST', { formData, timeout })
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
