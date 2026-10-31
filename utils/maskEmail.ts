/**
 * Email-shaped text inside free-form content. Deliberately loose: the local
 * part allows the RFC "atext" set plus dots, the domain any dotted label run,
 * so addresses typed into reasons or stored in JSON dumps both match.
 */
const LOCAL_CHAR = "[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]"
const LABEL = '[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?'
const EMAIL_SOURCE = `${LOCAL_CHAR}+@${LABEL}(?:\\.${LABEL})+`

// The lookbehind lets a match start only where the local part starts. Without
// it a backtracking engine retries from every character of a long run that has
// no `@`, which costs tens of milliseconds on a 10k-character log entry. The
// match set is unchanged: the regex is greedy, so a match always begins at the
// start of such a run anyway.
const EMAIL_PATTERN = new RegExp(`(?<!${LOCAL_CHAR})${EMAIL_SOURCE}`, 'g')

/**
 * The same pattern for PostgreSQL's `regexp_replace` (ARE syntax accepts
 * these classes and non-capturing groups unchanged), so a database-side
 * search sees exactly the text the masked view shows.
 */
export const EMAIL_REGEX_SQL = EMAIL_SOURCE

export const EMAIL_MASK = '[邮箱已隐藏]'

/** Lowest role that reads management log text unmasked (09 §5.3). */
export const LOG_FULL_CONTENT_MIN_ROLE = 4

export const LOG_EMAIL_SEARCH_DENIED = '只有超级管理员可以按邮箱搜索管理日志'

/** Replaces every email-shaped substring with a fixed marker. */
export const maskEmails = (text: string) =>
  text.replace(EMAIL_PATTERN, EMAIL_MASK)

/**
 * A term with `@` targets an address; masked viewers may not search for one.
 * Fragments without `@` are handled by searching the masked text instead.
 */
export const searchesIntoEmail = (term: string) => term.includes('@')
