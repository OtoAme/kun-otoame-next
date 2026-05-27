import {
  DEFAULT_KUN_SITE_THEME,
  KUN_ENABLED_SITE_THEME_IDS,
  KUN_SITE_THEME_COOKIE_MAX_AGE_SECONDS,
  KUN_SITE_THEME_COOKIE_PATH,
  KUN_SITE_THEME_COOKIE_SAME_SITE,
  KUN_SITE_THEME_STORAGE_KEY
} from '~/constants/theme'

interface SiteThemeScriptProps {
  nonce?: string
}

const siteThemeScript = `(() => {
  const storageKey = ${JSON.stringify(KUN_SITE_THEME_STORAGE_KEY)};
  const defaultTheme = ${JSON.stringify(DEFAULT_KUN_SITE_THEME)};
  const enabledThemes = ${JSON.stringify(KUN_ENABLED_SITE_THEME_IDS)};
  const cookieMaxAge = ${JSON.stringify(KUN_SITE_THEME_COOKIE_MAX_AGE_SECONDS)};
  const cookiePath = ${JSON.stringify(KUN_SITE_THEME_COOKIE_PATH)};
  const cookieSameSite = ${JSON.stringify(KUN_SITE_THEME_COOKIE_SAME_SITE)};
  const isEnabledTheme = (theme) => enabledThemes.includes(theme);
  const readCookieTheme = () => {
    try {
      const prefix = storageKey + '=';
      const cookie = document.cookie
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith(prefix));

      if (!cookie) {
        return undefined;
      }

      const value = decodeURIComponent(cookie.slice(prefix.length));
      return isEnabledTheme(value) ? value : undefined;
    } catch (_) {
      return undefined;
    }
  };
  const writeCookieTheme = (theme) => {
    try {
      const secure = location.protocol === 'https:' ? '; Secure' : '';
      document.cookie =
        storageKey +
        '=' +
        encodeURIComponent(theme) +
        '; Path=' +
        cookiePath +
        '; Max-Age=' +
        cookieMaxAge +
        '; SameSite=' +
        cookieSameSite +
        secure;
    } catch (_) {}
  };

  try {
    const root = document.documentElement;
    const serverTheme = root.dataset.kunTheme;

    if (root.dataset.kunThemeSource === 'server') {
      if (isEnabledTheme(serverTheme)) {
        try {
          localStorage.setItem(storageKey, serverTheme);
        } catch (_) {}
        writeCookieTheme(serverTheme);
      } else {
        root.dataset.kunTheme = defaultTheme;
      }
      return;
    }

    const cookieTheme = readCookieTheme();
    let storedTheme;

    try {
      const storedValue = localStorage.getItem(storageKey);
      if (isEnabledTheme(storedValue)) {
        storedTheme = storedValue;
      }
    } catch (_) {}

    const nextTheme = cookieTheme || storedTheme || defaultTheme;
    root.dataset.kunTheme = nextTheme;

    const shouldPersistTheme = Boolean(cookieTheme || storedTheme);

    if (shouldPersistTheme) {
      try {
        localStorage.setItem(storageKey, nextTheme);
      } catch (_) {}
    }
    if (shouldPersistTheme) {
      writeCookieTheme(nextTheme);
    }
    root.dataset.kunThemeSource = 'client';
  } catch (_) {}
})();`

export const SiteThemeScript = ({ nonce }: SiteThemeScriptProps) => {
  return (
    <script
      id="kun-site-theme-script"
      nonce={nonce}
      dangerouslySetInnerHTML={{ __html: siteThemeScript }}
    />
  )
}
