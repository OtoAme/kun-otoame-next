import { kunMoyuMoe } from '~/config/moyu-moe'

type CloudflarePurgePayload = {
  files?: string[]
  prefixes?: string[]
}

type PurgeZone = 'default' | 'site'

const CLOUDFLARE_PURGE_TIMEOUT_MS = 3000

const getCloudflarePurgeConfigs = () => {
  const zoneId = process.env.KUN_CF_CACHE_ZONE_ID?.trim() ?? ''
  const token = process.env.KUN_CF_CACHE_PURGE_API_TOKEN?.trim() ?? ''

  return {
    default: { zoneId, token },
    site: {
      zoneId: process.env.KUN_CF_CACHE_SITE_ZONE_ID?.trim() ?? '',
      token: process.env.KUN_CF_CACHE_SITE_PURGE_API_TOKEN?.trim() || token
    }
  }
}

const parsePurgeUrl = (value: string, isPrefix: boolean) => {
  try {
    const url = new URL(
      isPrefix && !/^[a-z][a-z\d+.-]*:\/\//i.test(value)
        ? `https://${value}`
        : value
    )
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

const sanitizePurgeErrors = (errors: unknown, secrets: string[]) => {
  if (!Array.isArray(errors)) return []

  return errors.slice(0, 5).flatMap((error: unknown) => {
    if (!error || typeof error !== 'object') return []
    const { code, message } = error as { code?: unknown; message?: unknown }
    let safeMessage = typeof message === 'string' ? message : ''
    // API errors can echo request URLs or configuration. Log diagnostics only.
    safeMessage = safeMessage.replace(/https?:\/\/[^\s"'<>]+/gi, '[url]')
    for (const secret of secrets) {
      safeMessage = safeMessage.split(secret).join('[redacted]')
    }
    return [
      {
        code: typeof code === 'number' ? code : undefined,
        message: safeMessage.slice(0, 500)
      }
    ]
  })
}

const normalizePublicPath = (path: string) =>
  path.startsWith('/') ? path : `/${path}`

const toPublicUrl = (path: string) =>
  `${kunMoyuMoe.domain.main}${normalizePublicPath(path)}`

const unique = (values: string[]) => [...new Set(values)]

export const purgeCloudflareCache = async (
  payload: string[] | CloudflarePurgePayload
): Promise<{ status: number; success: boolean }> => {
  const configs = getCloudflarePurgeConfigs()
  const body = Array.isArray(payload) ? { files: payload } : payload
  const siteHostname = new URL(kunMoyuMoe.domain.main).hostname
  const groups = new Map<
    PurgeZone,
    { body: CloudflarePurgePayload; hostnames: Set<string> }
  >()

  for (const kind of ['files', 'prefixes'] as const) {
    for (const value of body[kind] ?? []) {
      const url = parsePurgeUrl(value, kind === 'prefixes')
      // SaaS visitor hostnames select an explicitly configured provider zone;
      // neither the zone nor the purge URL is derived from the fallback origin.
      const zone =
        configs.site.zoneId && url?.hostname === siteHostname
          ? 'site'
          : 'default'
      let group = groups.get(zone)
      if (!group) {
        group = { body: {}, hostnames: new Set() }
        groups.set(zone, group)
      }
      if (url) group.hostnames.add(url.hostname)
      const values = (group.body[kind] ??= [])
      values.push(
        kind === 'prefixes' && url ? `${url.host}${url.pathname}` : value
      )
    }
  }

  const secrets = unique(
    Object.values(configs).flatMap(({ zoneId, token }) =>
      [zoneId, token].filter(Boolean)
    )
  )
  const results = await Promise.all(
    [...groups].map(async ([zone, group]) => {
      const config = configs[zone]
      const reportFailure = (
        reason: string,
        status: number,
        errors?: unknown
      ) => {
        console.error('[Cloudflare] Purge cache was not confirmed:', {
          zone,
          status,
          hostnames: [...group.hostnames],
          reason,
          errors: sanitizePurgeErrors(errors, secrets)
        })
      }

      if (!config.zoneId || !config.token) {
        if (zone === 'site') reportFailure('missing_config', 0)
        return { status: 0, success: false }
      }
      for (const kind of ['files', 'prefixes'] as const) {
        if (group.body[kind]) group.body[kind] = unique(group.body[kind])
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
            body: JSON.stringify(group.body)
          }
        )

        let parsed: { success?: unknown; errors?: unknown } | null
        try {
          parsed = await res.json()
        } catch {
          reportFailure('unreadable_response', res.status)
          return { status: res.status, success: false }
        }

        // Retry queues require Cloudflare's explicit acknowledgement for every zone.
        const success = res.ok && parsed?.success === true
        if (!success) reportFailure('api_rejected', res.status, parsed?.errors)
        return { status: res.status, success }
      } catch {
        reportFailure('request_failed', 0)
        return { status: 0, success: false }
      }
    })
  )

  return (
    results.find((result) => !result.success) ??
    results[0] ?? { status: 0, success: false }
  )
}

export const purgePublicPageCache = async (paths: string[]) => {
  await purgeCloudflareCache({ files: unique(paths.map(toPublicUrl)) })
}

export const purgePublicApiCache = async (paths: string[]) => {
  // The helper converts full URLs to hostname/path, covering all query variants.
  await purgeCloudflareCache({
    prefixes: unique(paths.map(toPublicUrl))
  })
}
