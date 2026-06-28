import { lookup as dnsLookup } from 'node:dns/promises'
import { basename, extname } from 'node:path'
import { isIP } from 'node:net'

export interface RemoteGalleryImagePayload {
  fileName: string
  contentType: string
  base64: string
}

type LookupResult = { address: string; family: number }

interface RemoteGalleryImportOptions {
  fetchImpl?: typeof fetch
  lookup?: (hostname: string) => Promise<LookupResult[]>
  maxBytes?: number
  maxRedirects?: number
}

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024
const DEFAULT_MAX_REDIRECTS = 3

const contentTypeToExtension: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif'
}

const isPrivateIPv4 = (address: string) => {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return true
  }

  const [a, b] = parts
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a === 0
  )
}

const isPrivateIPv6 = (address: string) => {
  const normalized = address.toLowerCase()
  return (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:')
  )
}

const isPrivateAddress = (address: string) => {
  const version = isIP(address)
  if (version === 4) return isPrivateIPv4(address)
  if (version === 6) return isPrivateIPv6(address)
  return true
}

const parseRemoteUrl = (value: string) => {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return '仅支持 HTTP/HTTPS 图片地址'
    }
    if (!url.hostname) {
      return '图片地址格式不正确'
    }
    return url
  } catch {
    return '图片地址格式不正确'
  }
}

const resolveHostname = async (
  hostname: string,
  lookup: RemoteGalleryImportOptions['lookup']
) => {
  if (isIP(hostname)) {
    return [{ address: hostname, family: isIP(hostname) }]
  }

  return lookup
    ? lookup(hostname)
    : dnsLookup(hostname, { all: true, verbatim: true })
}

const assertPublicUrl = async (
  url: URL,
  lookup: RemoteGalleryImportOptions['lookup']
) => {
  const records = await resolveHostname(url.hostname, lookup)
  if (
    records.length === 0 ||
    records.some((record) => isPrivateAddress(record.address))
  ) {
    return '不支持导入内网图片地址'
  }

  return null
}

const detectImageContentType = (buffer: Buffer, headerType: string) => {
  const normalizedType = headerType.split(';')[0].trim().toLowerCase()
  if (contentTypeToExtension[normalizedType]) {
    return normalizedType
  }

  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return 'image/jpeg'
  }

  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    )
  ) {
    return 'image/png'
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp'
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(4, 8).toString('ascii') === 'ftyp' &&
    (buffer.subarray(8, 12).toString('ascii') === 'avif' ||
      buffer.subarray(8, 12).toString('ascii') === 'avis')
  ) {
    return 'image/avif'
  }

  return null
}

const getRemoteFileName = (url: URL, contentType: string) => {
  const extension = contentTypeToExtension[contentType] ?? 'jpg'
  const rawName = decodeURIComponent(basename(url.pathname))
  const sanitized = rawName.replace(/[^\w.-]+/g, '-')
  const fallback = `remote-gallery.${extension}`

  if (!sanitized || sanitized === '/' || sanitized === '.') {
    return fallback
  }

  return extname(sanitized) ? sanitized : `${sanitized}.${extension}`
}

export const importRemoteGalleryImage = async (
  urlValue: string,
  options: RemoteGalleryImportOptions = {}
): Promise<RemoteGalleryImagePayload | string> => {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  const fetchImpl = options.fetchImpl ?? fetch

  let currentUrl = parseRemoteUrl(urlValue)
  if (typeof currentUrl === 'string') {
    return currentUrl
  }

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
    const publicUrlError = await assertPublicUrl(currentUrl, options.lookup)
    if (publicUrlError) {
      return publicUrlError
    }

    let response: Response
    try {
      response = await fetchImpl(currentUrl.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(15000)
      })
    } catch {
      return '远程图片下载失败'
    }

    if (
      response.status >= 300 &&
      response.status < 400 &&
      response.headers.get('location')
    ) {
      const location = response.headers.get('location')!
      currentUrl = new URL(location, currentUrl)
      continue
    }

    if (!response.ok) {
      return '远程图片下载失败'
    }

    const contentLength = Number(response.headers.get('content-length') ?? 0)
    if (contentLength > maxBytes) {
      return '远程图片体积过大, 超过 8MB'
    }

    const arrayBuffer = await response.arrayBuffer()
    if (arrayBuffer.byteLength > maxBytes) {
      return '远程图片体积过大, 超过 8MB'
    }

    const buffer = Buffer.from(arrayBuffer)
    const contentType = detectImageContentType(
      buffer,
      response.headers.get('content-type') ?? ''
    )
    if (!contentType) {
      return '远程地址不是支持的图片'
    }

    return {
      fileName: getRemoteFileName(currentUrl, contentType),
      contentType,
      base64: buffer.toString('base64')
    }
  }

  return '远程图片重定向次数过多'
}
