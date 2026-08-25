import { kunMoyuMoe } from '~/config/moyu-moe'

type CloudflarePurgePayload = {
  files?: string[]
  prefixes?: string[]
}

const CLOUDFLARE_PURGE_TIMEOUT_MS = 3000

const getCloudflarePurgeConfig = () => {
  const zoneId = process.env.KUN_CF_CACHE_ZONE_ID
  const token = process.env.KUN_CF_CACHE_PURGE_API_TOKEN

  if (!zoneId || !token) {
    return null
  }

  return { zoneId, token }
}

const normalizePublicPath = (path: string) =>
  path.startsWith('/') ? path : `/${path}`

const toPublicUrl = (path: string) =>
  `${kunMoyuMoe.domain.main}${normalizePublicPath(path)}`

const unique = (values: string[]) => [...new Set(values)]

export const purgeCloudflareCache = async (
  payload: string[] | CloudflarePurgePayload
): Promise<{ status: number; success: boolean }> => {
  const config = getCloudflarePurgeConfig()
  const body = Array.isArray(payload) ? { files: payload } : payload
  if (
    !config ||
    ((body.files?.length ?? 0) === 0 && (body.prefixes?.length ?? 0) === 0)
  ) {
    return { status: 0, success: false }
  }

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${config.zoneId}/purge_cache`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.token}`
        },
        signal: AbortSignal.timeout(CLOUDFLARE_PURGE_TIMEOUT_MS),
        body: JSON.stringify(body)
      }
    )

    if (!res.ok) {
      console.error('[Cloudflare] Purge cache failed:', res.status)
      return { status: res.status, success: false }
    }

    // A 2xx is not by itself a confirmation: the v4 API wraps every response in
    // `success`, and reports a rejected purge as 200 with `success: false`.
    // Callers that keep a retry queue need the real answer.
    let success = false
    try {
      const parsed = (await res.json()) as { success?: unknown }
      success = parsed?.success === true
    } catch (error) {
      console.error('[Cloudflare] Purge cache response was unreadable:', error)
    }

    if (!success) {
      console.error('[Cloudflare] Purge cache was not confirmed:', res.status)
    }

    return { status: res.status, success }
  } catch (error) {
    console.error('[Cloudflare] Purge cache request failed:', error)
    return { status: 0, success: false }
  }
}

export const purgePublicPageCache = async (paths: string[]) => {
  await purgeCloudflareCache({ files: unique(paths.map(toPublicUrl)) })
}

export const purgePublicApiCache = async (paths: string[]) => {
  // Cloudflare prefix purge does not accept query strings; the path prefix
  // itself covers query variants for the same endpoint.
  await purgeCloudflareCache({
    prefixes: unique(paths.map(toPublicUrl))
  })
}
