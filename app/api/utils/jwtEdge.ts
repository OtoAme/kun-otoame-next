import type { KunGalgamePayload } from './jwt'

const textEncoder = new TextEncoder()

const decodeBase64Url = (value: string) => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

const decodeJson = <T>(value: string): T => {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value))) as T
}

const importSecret = () =>
  crypto.subtle.importKey(
    'raw',
    textEncoder.encode(process.env.JWT_SECRET!),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  )

export const verifyKunTokenEdge = async (token: string) => {
  if (!token) {
    return null
  }

  try {
    const [encodedHeader, encodedPayload, encodedSignature] = token.split('.')
    if (!encodedHeader || !encodedPayload || !encodedSignature) {
      return null
    }

    const header = decodeJson<{ alg?: string }>(encodedHeader)
    if (header.alg !== 'HS256') {
      return null
    }

    const verified = await crypto.subtle.verify(
      'HMAC',
      await importSecret(),
      decodeBase64Url(encodedSignature),
      textEncoder.encode(`${encodedHeader}.${encodedPayload}`)
    )
    if (!verified) {
      return null
    }

    const payload = decodeJson<KunGalgamePayload & {
      iss?: string
      aud?: string
      exp?: number
    }>(encodedPayload)
    const now = Math.floor(Date.now() / 1000)

    if (payload.iss !== process.env.JWT_ISS || payload.aud !== process.env.JWT_AUD) {
      return null
    }
    if (payload.exp !== undefined && payload.exp <= now) {
      return null
    }

    return payload
  } catch {
    return null
  }
}
