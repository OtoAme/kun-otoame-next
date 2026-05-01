const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/

export const SAFE_LINK_PROTOCOLS = [
  'http:',
  'https:',
  'mailto:',
  'irc:',
  'ircs:',
  'xmpp:',
  'magnet:',
  'ed2k:',
  'thunder:'
] as const
export const SAFE_MEDIA_PROTOCOLS = ['http:', 'https:'] as const
export const SAFE_LINK_PROTOCOL_NAMES = SAFE_LINK_PROTOCOLS.map((protocol) =>
  protocol.slice(0, -1)
)
export const SAFE_MEDIA_PROTOCOL_NAMES = SAFE_MEDIA_PROTOCOLS.map((protocol) =>
  protocol.slice(0, -1)
)

export const sanitizeUserUrl = (
  url: string,
  allowedProtocols: readonly string[] = SAFE_LINK_PROTOCOLS
) => {
  const trimmedUrl = url.trim()

  if (!trimmedUrl || CONTROL_CHARACTER_PATTERN.test(trimmedUrl)) {
    return null
  }

  const protocolMatch = trimmedUrl.match(/^([a-zA-Z][a-zA-Z\d+.-]*):/)
  if (!protocolMatch) {
    return trimmedUrl
  }

  const protocol = `${protocolMatch[1].toLowerCase()}:`

  return allowedProtocols.includes(protocol)
    ? `${protocol}${trimmedUrl.slice(protocolMatch[0].length)}`
    : null
}

export const sanitizeUserHref = (url: string) =>
  sanitizeUserUrl(url, SAFE_LINK_PROTOCOLS)
