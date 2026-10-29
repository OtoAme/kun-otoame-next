import {
  parseBangumiIdInput,
  parseSteamIdInput,
  parseVndbIdInput
} from './externalIds'

export const HELP_GAME_LINK_MAX = 5
export const HELP_GAME_LINK_MAX_LENGTH = 500

export type HelpGameLinkKind = 'vndb' | 'bangumi' | 'steam' | 'other'

export interface HelpGameLinkInfo {
  kind: HelpGameLinkKind
  /** e.g. 「VNDB v12345」, or the host name for other sites. */
  label: string
}

/** Names a reference link so readers see where it points before opening it. */
export const describeHelpGameLink = (url: string): HelpGameLinkInfo => {
  const vndb = parseVndbIdInput(url)
  if (vndb) return { kind: 'vndb', label: `VNDB ${vndb}` }
  const bangumi = parseBangumiIdInput(url)
  if (bangumi) return { kind: 'bangumi', label: `Bangumi ${bangumi}` }
  const steam = parseSteamIdInput(url)
  if (steam) return { kind: 'steam', label: `Steam ${steam}` }
  try {
    return { kind: 'other', label: new URL(url).hostname }
  } catch {
    return { kind: 'other', label: url }
  }
}

/** Only http(s) links are kept; blank entries and duplicates are dropped. */
export const normalizeHelpGameLinks = (links: readonly string[]) => [
  ...new Set(links.map((link) => link.trim()).filter(Boolean))
]

export const isHttpUrl = (value: string) => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}
