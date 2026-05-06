const normalizeInput = (value: string) => value.trim()

const parseUrlLikeInput = (value: string) => {
  const input = normalizeInput(value)

  try {
    return new URL(input)
  } catch {
    try {
      return new URL(`https://${input}`)
    } catch {
      return null
    }
  }
}

const getPathSegments = (url: URL) =>
  url.pathname.split('/').filter((segment) => segment.length > 0)

const isVndbHost = (hostname: string) =>
  hostname === 'vndb.org' || hostname.endsWith('.vndb.org')

const isBangumiHost = (hostname: string) =>
  ['bgm.tv', 'bangumi.tv', 'chii.in'].some(
    (host) => hostname === host || hostname.endsWith(`.${host}`)
  )

const isSteamHost = (hostname: string) =>
  ['store.steampowered.com', 'steamcommunity.com'].some(
    (host) => hostname === host || hostname.endsWith(`.${host}`)
  )

const parseDirectId = (value: string, pattern: RegExp) => {
  const input = normalizeInput(value)
  return pattern.test(input) ? input.toLowerCase() : ''
}

const parseVndbPathId = (value: string, pattern: RegExp) => {
  const directId = parseDirectId(value, pattern)
  if (directId) {
    return directId
  }

  const url = parseUrlLikeInput(value)
  if (!url || !isVndbHost(url.hostname)) {
    return ''
  }

  return (
    getPathSegments(url)
      .find((segment) => pattern.test(segment))
      ?.toLowerCase() ?? ''
  )
}

export const parseVndbIdInput = (value: string) =>
  parseVndbPathId(value, /^v\d+$/i)

export const parseVndbRelationIdInput = (value: string) =>
  parseVndbPathId(value, /^r\d+$/i)

export const parseBangumiIdInput = (value: string) => {
  const input = normalizeInput(value)
  if (/^\d+$/.test(input)) {
    return input
  }

  const url = parseUrlLikeInput(input)
  if (!url || !isBangumiHost(url.hostname)) {
    return ''
  }

  const segments = getPathSegments(url)
  const subjectIndex = segments.findIndex((segment) => segment === 'subject')
  const subjectId = subjectIndex >= 0 ? segments[subjectIndex + 1] : ''

  return /^\d+$/.test(subjectId) ? subjectId : ''
}

export const parseSteamIdInput = (value: string) => {
  const input = normalizeInput(value)
  if (/^\d+$/.test(input)) {
    return input
  }

  const url = parseUrlLikeInput(input)
  if (!url || !isSteamHost(url.hostname)) {
    return ''
  }

  const segments = getPathSegments(url)
  const appIndex = segments.findIndex((segment) => segment === 'app')
  const appId = appIndex >= 0 ? segments[appIndex + 1] : ''

  return /^\d+$/.test(appId) ? appId : ''
}

export const normalizeVndbIdInput = (value: string) =>
  parseVndbIdInput(value) || normalizeInput(value)

export const normalizeVndbRelationIdInput = (value: string) =>
  parseVndbRelationIdInput(value) || normalizeInput(value)

export const normalizeBangumiIdInput = (value: string) =>
  parseBangumiIdInput(value) || normalizeInput(value)

export const normalizeSteamIdInput = (value: string) =>
  parseSteamIdInput(value) || normalizeInput(value)
