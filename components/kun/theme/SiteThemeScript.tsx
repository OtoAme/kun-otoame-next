import {
  DEFAULT_KUN_SITE_THEME,
  KUN_ENABLED_SITE_THEME_IDS,
  KUN_SITE_THEME_STORAGE_KEY
} from '~/constants/theme'

interface SiteThemeScriptProps {
  nonce?: string
}

const siteThemeScript = `(() => {
  const storageKey = ${JSON.stringify(KUN_SITE_THEME_STORAGE_KEY)};
  const defaultTheme = ${JSON.stringify(DEFAULT_KUN_SITE_THEME)};
  const enabledThemes = ${JSON.stringify(KUN_ENABLED_SITE_THEME_IDS)};
  const isEnabledTheme = (theme) => enabledThemes.includes(theme);

  try {
    const root = document.documentElement;
    const serverTheme = root.dataset.kunTheme;

    if (root.dataset.kunThemeSource === 'server') {
      if (isEnabledTheme(serverTheme)) {
        try {
          localStorage.setItem(storageKey, serverTheme);
        } catch (_) {}
      } else {
        root.dataset.kunTheme = defaultTheme;
      }
      return;
    }

    let nextTheme = defaultTheme;

    try {
      const storedTheme = localStorage.getItem(storageKey);
      if (isEnabledTheme(storedTheme)) {
        nextTheme = storedTheme;
      }
    } catch (_) {}

    root.dataset.kunTheme = nextTheme;
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
