import type { LinkCheckProvider } from '~/types/api/linkHealth'

const pan123Hosts = new Set([
  '123pan.com',
  'www.123pan.com',
  '123684.com',
  'www.123684.com',
  '123865.com',
  'www.123865.com',
  '123912.com',
  'www.123912.com',
  '123pan.cn',
  'www.123pan.cn',
  'share.123pan.cn',
  '123684.cn',
  'www.123684.cn',
  '123865.cn',
  'www.123865.cn',
  '123912.cn',
  'www.123912.cn'
])

export const getCaiyunShareId = (url: URL) => {
  const fragmentQuery = url.hash.split('?')[1] ?? ''
  const id =
    url.searchParams.get('linkID') ||
    new URLSearchParams(fragmentQuery).get('linkID') ||
    url.search.slice(1).split('&')[0]
  return /^[A-Za-z0-9_-]+$/.test(id) ? id : null
}

/**
 * Same host/path rules as the link-check adapter. Safe for client UI
 * (netdisk chips); outbound mapping still lives only in the checker.
 */
export const recognizeLinkCheckProviderFromUrl = (
  url: URL
): LinkCheckProvider | null => {
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port
  ) {
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
  if (
    (url.hostname === 'caiyun.139.com' || url.hostname === 'yun.139.com') &&
    getCaiyunShareId(url)
  ) {
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
