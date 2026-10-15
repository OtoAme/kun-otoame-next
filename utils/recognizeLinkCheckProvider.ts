import type { LinkCheckProvider } from '~/types/api/linkHealth'

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

/**
 * Same host/path rules as the link-check adapter. Safe for client UI
 * (netdisk chips); outbound mapping still lives only in the checker.
 */
export const recognizeLinkCheckProviderFromUrl = (
  url: URL
): LinkCheckProvider | null => {
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    return null
  }
  if (
    url.hostname === 'pan.quark.cn' &&
    /^\/s\/[A-Za-z0-9]+\/?$/.test(url.pathname)
  ) {
    return 'quark'
  }
  if (
    url.hostname === 'drive.uc.cn' &&
    /^\/s\/[A-Za-z0-9]+\/?$/.test(url.pathname)
  ) {
    return 'uc'
  }
  if (
    url.hostname === 'pan.baidu.com' &&
    /^\/s\/1[A-Za-z0-9_-]+\/?$/.test(url.pathname)
  ) {
    return 'baidu'
  }
  if (url.hostname === 'caiyun.139.com' || url.hostname === 'yun.139.com') {
    return 'caiyun'
  }
  if (
    pan123Hosts.has(url.hostname) &&
    /^\/(s|123pan)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)
  ) {
    return 'pan123'
  }
  return null
}

export const recognizeLinkCheckProvider = (
  raw: string
): LinkCheckProvider | null => {
  try {
    return recognizeLinkCheckProviderFromUrl(new URL(raw))
  } catch {
    return null
  }
}
