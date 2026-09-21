import {
  NEXTMOE_CATALOG_BASE_URL,
  NEXTMOE_CATALOG_BATCH_MAX,
  nextmoeCompanyListSchema,
  nextmoeWorkListSchema,
  type NextmoeCompanyList,
  type NextmoeWorkList
} from './types'

export {
  NEXTMOE_CATALOG_BATCH_MAX,
  NEXTMOE_COMPANY_VALUE_MAX_LENGTH,
  nextmoeAliasValues
} from './types'
export type {
  NextmoeCompany,
  NextmoeCompanyAlias,
  NextmoeCompanyList,
  NextmoeRef,
  NextmoeWork,
  NextmoeWorkCompany,
  NextmoeWorkList
} from './types'

const NEXTMOE_CATALOG_WORKS_PATH = '/v2/catalog/works'
const NEXTMOE_CATALOG_COMPANIES_PATH = '/v2/catalog/companies'
const NEXTMOE_CATALOG_WORKS_INCLUDE = 'companies,refs'
const NEXTMOE_CATALOG_COMPANIES_INCLUDE = 'aliases'

const NEXTMOE_CATALOG_MAX_ATTEMPTS = 3
const NEXTMOE_CATALOG_JITTER_MAX_MS = 100
const NEXTMOE_CATALOG_RETRY_AFTER_MIN_SECONDS = 1
const NEXTMOE_CATALOG_RETRY_AFTER_MAX_SECONDS = 60
const NEXTMOE_CATALOG_SERVER_ERROR_BASE_DELAY_MS = 200
const NEXTMOE_CATALOG_SERVER_ERROR_MAX_DELAY_MS = 2000

type NextmoeCatalogLane = 'ids' | 'refs'

export type NextmoeCatalogClientOptions = {
  apiKey?: string | null
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

export type NextmoeCatalogClient = {
  listWorksByRefs(refs: string[]): Promise<NextmoeWorkList>
  listCompaniesByIds(ids: string[]): Promise<NextmoeCompanyList>
  listCompaniesByRefs(refs: string[]): Promise<NextmoeCompanyList>
}

type NextmoeFailureKind =
  | 'auth'
  | 'quota'
  | 'rate-limited'
  | 'server'
  | 'unavailable'
  | 'missing'

const NEXTMOE_CATALOG_FETCH_TIMEOUT_MS = 15000

const isCloudflareOriginFailure = (status: number) =>
  status >= 520 && status <= 527

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

const hasApiKey = (apiKey: string | null | undefined): apiKey is string =>
  typeof apiKey === 'string' && apiKey.length > 0

export const isNextmoeCatalogConfigured = () =>
  hasApiKey(process.env.KUN_NEXTMOE_API_KEY)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const jitterMs = () => Math.floor(Math.random() * NEXTMOE_CATALOG_JITTER_MAX_MS)

const retryAfterMs = (response: Response) => {
  const seconds = Number(response.headers.get('retry-after'))
  const clamped = Number.isFinite(seconds)
    ? Math.min(
        Math.max(seconds, NEXTMOE_CATALOG_RETRY_AFTER_MIN_SECONDS),
        NEXTMOE_CATALOG_RETRY_AFTER_MAX_SECONDS
      )
    : NEXTMOE_CATALOG_RETRY_AFTER_MIN_SECONDS
  return clamped * 1000 + jitterMs()
}

const serverErrorDelayMs = (attempt: number) =>
  Math.min(
    NEXTMOE_CATALOG_SERVER_ERROR_BASE_DELAY_MS * 2 ** attempt + jitterMs(),
    NEXTMOE_CATALOG_SERVER_ERROR_MAX_DELAY_MS
  )

const readProblemCode = async (response: Response) => {
  try {
    const body: unknown = await response.json()
    return isRecord(body) && typeof body.code === 'string' ? body.code : null
  } catch {
    return null
  }
}

const classifyFailure = (
  status: number,
  code: string | null
): NextmoeFailureKind => {
  if (status === 401 || status === 403) return 'auth'
  if (status === 429 && code === 'QUOTA_EXCEEDED') return 'quota'
  if (status === 429) return 'rate-limited'
  if (isCloudflareOriginFailure(status)) return 'unavailable'
  if (status >= 500) return 'server'
  // ENTITY_MERGED and every other unretryable status resolve as missing keys.
  return 'missing'
}

const assertBatchSize = (keys: string[]) => {
  if (keys.length > NEXTMOE_CATALOG_BATCH_MAX) {
    throw new Error(
      `NextMoe catalog batch lanes accept at most ${NEXTMOE_CATALOG_BATCH_MAX} keys, received ${keys.length}`
    )
  }
}

const parseWorkList = (body: unknown): NextmoeWorkList | null => {
  const parsed = nextmoeWorkListSchema.safeParse(body)
  return parsed.success ? parsed.data : null
}

const parseCompanyList = (body: unknown): NextmoeCompanyList | null => {
  const parsed = nextmoeCompanyListSchema.safeParse(body)
  return parsed.success ? parsed.data : null
}

export const createNextmoeCatalogClient = (
  options: NextmoeCatalogClientOptions = {}
): NextmoeCatalogClient => {
  const resolvedKey =
    options.apiKey !== undefined
      ? options.apiKey
      : (process.env.KUN_NEXTMOE_API_KEY ?? null)
  const configuredKey = hasApiKey(resolvedKey) ? resolvedKey : null
  const requestFetch: typeof fetch =
    options.fetch ?? ((input, init) => fetch(input, init))
  const sleep = options.sleep ?? defaultSleep

  let disabled = configuredKey === null

  const buildUrl = (
    path: string,
    lane: NextmoeCatalogLane,
    include: string,
    keys: string[]
  ) =>
    `${NEXTMOE_CATALOG_BASE_URL}${path}?${lane}=${keys.join(',')}&include=${include}&nsfw=true`

  const listCounts = (parsed: unknown) => {
    if (!isRecord(parsed)) return { items: 0, missing: 0 }
    return {
      items: Array.isArray(parsed.items) ? parsed.items.length : 0,
      missing: Array.isArray(parsed.missing) ? parsed.missing.length : 0
    }
  }

  const logCatalog = (
    path: string,
    lane: NextmoeCatalogLane,
    include: string,
    keys: string[],
    attempt: number,
    result: string,
    ms: number,
    extra = ''
  ) => {
    const line =
      `[nextmoe] GET ${path} ${lane}=${keys.length} include=${include} ` +
      `attempt=${attempt + 1}/${NEXTMOE_CATALOG_MAX_ATTEMPTS} -> ${result} ${ms}ms` +
      extra
    if (result.startsWith('2') || result === 'ok') {
      // eslint-disable-next-line no-console
      console.info(line)
    } else {
      // eslint-disable-next-line no-console
      console.error(line)
    }
  }

  const requestList = async <T>(
    path: string,
    lane: NextmoeCatalogLane,
    include: string,
    keys: string[],
    parseBody: (body: unknown) => T | null
  ): Promise<T | null> => {
    if (disabled || configuredKey === null) return null

    for (
      let attempt = 0;
      attempt < NEXTMOE_CATALOG_MAX_ATTEMPTS;
      attempt += 1
    ) {
      let response: Response
      const started = Date.now()
      try {
        response = await requestFetch(buildUrl(path, lane, include, keys), {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${configuredKey}`,
            Accept: 'application/json'
          },
          signal: AbortSignal.timeout(NEXTMOE_CATALOG_FETCH_TIMEOUT_MS)
        })
      } catch (error) {
        const timedOut =
          error instanceof Error &&
          (error.name === 'TimeoutError' || error.name === 'AbortError')
        const detail =
          error instanceof Error ? error.message : 'unknown fetch error'
        logCatalog(
          path,
          lane,
          include,
          keys,
          attempt,
          timedOut ? 'timeout' : 'network-error',
          Date.now() - started,
          ` items=0 missing=${keys.length} (${detail})`
        )
        if (!timedOut) {
          disabled = true
          return null
        }
        if (attempt === NEXTMOE_CATALOG_MAX_ATTEMPTS - 1) return null
        await sleep(serverErrorDelayMs(attempt))
        continue
      }

      const elapsed = Date.now() - started
      const requestId = response.headers.get('x-request-id')
      const requestIdNote = requestId ? ` X-Request-ID=${requestId}` : ''

      if (response.ok) {
        let body: unknown
        try {
          body = await response.json()
        } catch {
          logCatalog(
            path,
            lane,
            include,
            keys,
            attempt,
            String(response.status),
            elapsed,
            ` items=0 missing=${keys.length} body=not-json${requestIdNote}`
          )
          return null
        }

        const parsed = parseBody(body)
        const counts = listCounts(parsed ?? body)
        logCatalog(
          path,
          lane,
          include,
          keys,
          attempt,
          parsed ? String(response.status) : `${response.status}-unparsed`,
          elapsed,
          ` items=${counts.items} missing=${counts.missing}${requestIdNote}`
        )
        if (parsed === null) {
          console.error(
            '[nextmoe] catalog response did not match the expected shape'
          )
        }
        return parsed
      }

      const kind = classifyFailure(
        response.status,
        await readProblemCode(response)
      )
      logCatalog(
        path,
        lane,
        include,
        keys,
        attempt,
        String(response.status),
        elapsed,
        ` items=0 missing=${keys.length} kind=${kind}${requestIdNote}`
      )

      if (kind === 'auth' || kind === 'quota') {
        disabled = true
        return null
      }
      if (attempt === NEXTMOE_CATALOG_MAX_ATTEMPTS - 1) return null
      if (kind === 'rate-limited') {
        await sleep(retryAfterMs(response))
        continue
      }
      if (kind === 'server' || kind === 'unavailable') {
        await sleep(serverErrorDelayMs(attempt))
        continue
      }
      return null
    }

    return null
  }

  const emptyWorkList = (refs: string[]): NextmoeWorkList => ({
    object: 'list',
    items: [],
    missing: refs
  })

  const emptyCompanyList = (keys: string[]): NextmoeCompanyList => ({
    object: 'list',
    items: [],
    missing: keys
  })

  const listWorksByRefs = async (refs: string[]): Promise<NextmoeWorkList> => {
    assertBatchSize(refs)
    if (!refs.length) return emptyWorkList([])

    const list = await requestList(
      NEXTMOE_CATALOG_WORKS_PATH,
      'refs',
      NEXTMOE_CATALOG_WORKS_INCLUDE,
      refs,
      parseWorkList
    )
    return list ?? emptyWorkList(refs)
  }

  const listCompaniesByIds = async (
    ids: string[]
  ): Promise<NextmoeCompanyList> => {
    assertBatchSize(ids)
    if (!ids.length) return emptyCompanyList([])

    const list = await requestList(
      NEXTMOE_CATALOG_COMPANIES_PATH,
      'ids',
      NEXTMOE_CATALOG_COMPANIES_INCLUDE,
      ids,
      parseCompanyList
    )
    return list ?? emptyCompanyList(ids)
  }

  const listCompaniesByRefs = async (
    refs: string[]
  ): Promise<NextmoeCompanyList> => {
    assertBatchSize(refs)
    if (!refs.length) return emptyCompanyList([])

    const list = await requestList(
      NEXTMOE_CATALOG_COMPANIES_PATH,
      'refs',
      NEXTMOE_CATALOG_COMPANIES_INCLUDE,
      refs,
      parseCompanyList
    )
    return list ?? emptyCompanyList(refs)
  }

  return { listWorksByRefs, listCompaniesByIds, listCompaniesByRefs }
}
