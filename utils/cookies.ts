export const TEMP_2FA_COOKIE = 'kun-galgame-patch-moe-2fa-token'
export const RESOURCE_ACCESS_VISITOR_COOKIE = 'kun-resource-access-token'
export const DASHBOARD_SIDEBAR_COOKIE = 'dashboard_sidebar_state'

export const parseCookies = (cookieString: string) => {
  const cookiesKv: { [key: string]: string } = {}
  cookieString &&
    cookieString.split(';').forEach((cookie) => {
      const parts: string[] = cookie.split('=')
      if (parts.length) {
        cookiesKv[parts.shift()!.trim()] = decodeURI(parts.join('='))
      }
    })
  return cookiesKv
}
