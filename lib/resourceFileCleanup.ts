import type { Prisma } from '@prisma/client'

/**
 * Durable cleanup credential for resource objects removed with a handover.
 *
 * queueResourceFileCleanup only writes rows inside the caller's transaction.
 * processResourceFileCleanup runs after commit or from the replay command.
 * Neither function logs object keys, URLs, or download secrets.
 */

export const RESOURCE_FILE_CLEANUP_STATUSES = [
  'pending',
  'cancelled',
  'completed',
  'failed'
] as const

export type ResourceFileCleanupStatus =
  (typeof RESOURCE_FILE_CLEANUP_STATUSES)[number]

export const RESOURCE_FILE_CLEANUP_FAILURES = [
  'reference_query_failed',
  'delete_failed',
  'referenced_after_delete'
] as const

export type ResourceFileCleanupFailure =
  (typeof RESOURCE_FILE_CLEANUP_FAILURES)[number]

const REPLAYABLE_FAILURES = [
  'reference_query_failed',
  'delete_failed'
] as const satisfies readonly ResourceFileCleanupFailure[]

const RESOURCE_OBJECT_KEY = new RegExp(
  `^patch/[1-9]\\d*/resource/[0-9a-f]{64}/[^/?#\\\\${String.fromCharCode(0)}-${String.fromCharCode(31)}]+$`
)

export class ResourceFileCleanupError extends Error {
  readonly code: 'invalid_resource' | 'invalid_locator' | 'invalid_limit'

  constructor(code: ResourceFileCleanupError['code']) {
    super(code)
    this.name = 'ResourceFileCleanupError'
    this.code = code
  }
}

export type ResourceFileCleanupLink = {
  storage: string
  content: string
}

export type ResourceFileCleanupLogEvent = {
  cleanupId: number
  resourceId: number
  status: ResourceFileCleanupStatus
  failureCategory: ResourceFileCleanupFailure | null
}

type CleanupRow = {
  id: number
  object_key: string
  resource_id: number
  status: string
  failure_category: string | null
  updated: Date
}

const cleanupSelect = {
  id: true,
  object_key: true,
  resource_id: true,
  status: true,
  failure_category: true,
  updated: true
} as const

/** The two Prisma delegates this service calls. A transaction client satisfies it. */
export type ResourceFileCleanupClient = Pick<
  Prisma.TransactionClient,
  'patch_resource_file_cleanup' | 'patch_resource_link'
>

const isCleanupStatus = (value: string): value is ResourceFileCleanupStatus =>
  (RESOURCE_FILE_CLEANUP_STATUSES as readonly string[]).includes(value)

const isCleanupFailure = (
  value: string | null
): value is ResourceFileCleanupFailure | null =>
  value === null ||
  (RESOURCE_FILE_CLEANUP_FAILURES as readonly string[]).includes(value)

const assertRow = (row: CleanupRow): CleanupRow => {
  if (
    !isCleanupStatus(row.status) ||
    !isCleanupFailure(row.failure_category) ||
    !(row.updated instanceof Date)
  ) {
    throw new ResourceFileCleanupError('invalid_locator')
  }
  return row
}

const decodePath = (value: string) => {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

const normalizeResourceObjectKey = (value: string) => {
  if (
    !value ||
    value.length > 1007 ||
    value.includes('\\') ||
    value.includes('\0')
  ) {
    return null
  }
  const decoded = decodePath(value)
  if (
    decoded === null ||
    decoded.length > 1007 ||
    decoded.includes('\\') ||
    decoded.includes('\0') ||
    decoded.includes('?') ||
    decoded.includes('#')
  ) {
    return null
  }
  const segments = decoded.split('/')
  if (
    segments.some(
      (segment) => segment === '' || segment === '.' || segment === '..'
    )
  ) {
    return null
  }
  return RESOURCE_OBJECT_KEY.test(decoded) ? decoded : null
}

const approvedBase = (base: string) => {
  try {
    const parsed = new URL(base)
    if (parsed.username || parsed.password) return null
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    return parsed
  } catch {
    return null
  }
}

/**
 * Resolves a stored resource-object key. A URL counts only when its origin and
 * base path are one of the explicitly approved public bases. Query strings,
 * fragments, and URL userinfo are ignored and never returned.
 */
export const locateResourceObjectKey = (
  content: string,
  publicBases: readonly string[]
) => {
  const trimmed = content.trim()
  if (!trimmed || trimmed.length > 1007) return null
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return normalizeResourceObjectKey(trimmed)
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  if (parsed.username || parsed.password) return null
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  const path = parsed.pathname.replace(/^\/+/, '')
  for (const base of publicBases) {
    const approved = approvedBase(base)
    if (!approved || parsed.origin !== approved.origin) continue
    const basePath = approved.pathname.replace(/\/+$/, '').replace(/^\/+/, '')
    if (basePath && path !== basePath && !path.startsWith(`${basePath}/`))
      continue
    const remainder = basePath
      ? path.slice(basePath.length).replace(/^\/+/, '')
      : path
    const key = normalizeResourceObjectKey(remainder)
    if (key) return key
  }
  return null
}

const publicBasesFrom = (bases: readonly string[] | undefined) => {
  const source = bases ?? [
    process.env.NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL,
    process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL
  ]
  return [
    ...new Set(
      source
        .map((base) => base?.trim().replace(/\/+$/, ''))
        .filter((base): base is string => Boolean(base))
    )
  ]
}

const assertResourceId = (resourceId: number) => {
  if (!Number.isInteger(resourceId) || resourceId < 1 || resourceId > 9999999) {
    throw new ResourceFileCleanupError('invalid_resource')
  }
}

const assertLimit = (limit: number | undefined) => {
  if (limit === undefined) return 50
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new ResourceFileCleanupError('invalid_limit')
  }
  return limit
}

export const queueResourceFileCleanup = async (
  tx: ResourceFileCleanupClient,
  input: {
    resourceId: number
    links: readonly ResourceFileCleanupLink[]
    publicBases?: readonly string[]
  }
) => {
  assertResourceId(input.resourceId)
  const bases = publicBasesFrom(input.publicBases)
  const keys: string[] = []
  for (const link of input.links) {
    if (link.storage !== 's3') continue
    const key = locateResourceObjectKey(link.content, bases)
    if (!key) throw new ResourceFileCleanupError('invalid_locator')
    keys.push(key)
  }

  const jobIds: number[] = []
  for (const objectKey of [...new Set(keys)]) {
    const row = assertRow(
      await tx.patch_resource_file_cleanup.upsert({
        where: { object_key: objectKey },
        create: {
          object_key: objectKey,
          resource_id: input.resourceId,
          status: 'pending',
          failure_category: null
        },
        update: {
          resource_id: input.resourceId,
          status: 'pending',
          failure_category: null
        },
        select: cleanupSelect
      })
    )
    jobIds.push(row.id)
  }
  return { jobIds }
}

/**
 * Reads id and content, then applies locateResourceObjectKey. A literal prefix
 * is not a superset of one decodeURIComponent, so the query does not filter
 * by an encoded spelling of the key.
 */
const referencingLinkIds = async (
  client: ResourceFileCleanupClient,
  objectKey: string,
  publicBases: readonly string[]
) => {
  const rows = await client.patch_resource_link.findMany({
    select: { id: true, content: true }
  })
  return rows
    .filter(
      (row) => locateResourceObjectKey(row.content, publicBases) === objectKey
    )
    .map((row) => row.id)
}

// A re-queue changes `updated`. Completing or cancelling only when that value
// is unchanged keeps the new pending row instead of writing over it. It does
// not stop a new link inserted while DeleteObject is in flight.
const claimCleanup = async (
  client: ResourceFileCleanupClient,
  row: CleanupRow,
  status: ResourceFileCleanupStatus,
  failureCategory: ResourceFileCleanupFailure | null
) => {
  const result = await client.patch_resource_file_cleanup.updateMany({
    where: { id: row.id, updated: row.updated },
    data: { status, failure_category: failureCategory }
  })
  return result.count === 1
}

export type ResourceFileCleanupReport = {
  examined: number
  completed: number
  cancelled: number
  failed: number
}

/**
 * Replays durable cleanup rows. Reference checks and object deletion happen
 * outside any database transaction the caller may be holding; pass the root
 * client after commit. Active links use the same object identity as
 * locateResourceObjectKey. A reference found before delete keeps the object.
 * referenced_after_delete only records a reference seen after the delete; it
 * does not prove the object was unused beforehand.
 */
export const processResourceFileCleanup = async (
  client: ResourceFileCleanupClient,
  options: {
    limit?: number
    ids?: readonly number[]
    publicBases?: readonly string[]
    deleteObject: (objectKey: string) => Promise<'deleted' | 'absent'>
    log?: (event: ResourceFileCleanupLogEvent) => void
  }
): Promise<ResourceFileCleanupReport> => {
  const limit = assertLimit(options.limit)
  const bases = publicBasesFrom(options.publicBases)
  const report: ResourceFileCleanupReport = {
    examined: 0,
    completed: 0,
    cancelled: 0,
    failed: 0
  }
  if (options.ids && options.ids.length === 0) return report

  const rows = await client.patch_resource_file_cleanup.findMany({
    where: {
      ...(options.ids ? { id: { in: [...options.ids] } } : {}),
      OR: [
        { status: 'pending' },
        {
          status: 'failed',
          failure_category: { in: [...REPLAYABLE_FAILURES] }
        }
      ]
    },
    orderBy: [{ created: 'asc' }, { id: 'asc' }],
    take: limit,
    select: cleanupSelect
  })

  for (const row of rows) {
    const current = assertRow(row)
    report.examined += 1
    const record = async (
      status: ResourceFileCleanupStatus,
      failureCategory: ResourceFileCleanupFailure | null
    ) => {
      const claimed = await claimCleanup(
        client,
        current,
        status,
        failureCategory
      )
      if (!claimed) {
        options.log?.({
          cleanupId: current.id,
          resourceId: current.resource_id,
          status: 'pending',
          failureCategory: null
        })
        return false
      }
      options.log?.({
        cleanupId: current.id,
        resourceId: current.resource_id,
        status,
        failureCategory
      })
      return true
    }
    try {
      let references: number[]
      try {
        references = await referencingLinkIds(client, current.object_key, bases)
      } catch {
        if (await record('failed', 'reference_query_failed')) report.failed += 1
        continue
      }
      if (references.length > 0) {
        if (await record('cancelled', null)) report.cancelled += 1
        continue
      }

      try {
        const outcome = await options.deleteObject(current.object_key)
        if (outcome !== 'deleted' && outcome !== 'absent') {
          throw new ResourceFileCleanupError('invalid_locator')
        }
      } catch {
        if (await record('failed', 'delete_failed')) report.failed += 1
        continue
      }

      try {
        references = await referencingLinkIds(client, current.object_key, bases)
      } catch {
        if (await record('failed', 'reference_query_failed')) report.failed += 1
        continue
      }

      if (references.length > 0) {
        if (await record('failed', 'referenced_after_delete'))
          report.failed += 1
      } else if (await record('completed', null)) {
        report.completed += 1
      }
    } catch {
      report.failed += 1
      options.log?.({
        cleanupId: current.id,
        resourceId: current.resource_id,
        status: 'failed',
        failureCategory: 'delete_failed'
      })
    }
  }

  return report
}

export type PrismaResourceFileCleanupClient = Prisma.TransactionClient
