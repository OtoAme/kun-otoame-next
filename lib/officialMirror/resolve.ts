import { Prisma } from '@prisma/client'
import { asSection } from './decide'
import type { OfficialMirrorResolveHit } from '~/types/api/officialMirror'

type QueryClient = {
  $queryRaw: (query: Prisma.Sql) => Promise<unknown>
}

type VisibleResource = {
  id: number
  patch_id: number
  section: string
  patch: { unique_id: string }
}

export type ResolveReader = QueryClient & {
  patch_resource: {
    findFirst: (args: {
      where: Prisma.patch_resourceWhereInput
      select: {
        id: true
        patch_id: true
        section: true
        patch: { select: { unique_id: true } }
      }
    }) => Promise<VisibleResource | null>
  }
}

const survivorId = (rows: unknown) => {
  if (!Array.isArray(rows) || !rows.length) return null
  const value = (rows[0] as { user_resource_id?: unknown }).user_resource_id
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : null
}

/** One hop from a deleted staff card to the surviving user card. */
export const lookupMergedSurvivorId = async (
  db: QueryClient,
  resourceId: number
) => {
  const rows = await db.$queryRaw(Prisma.sql`
    SELECT user_resource_id
    FROM patch_resource_merge_record
    WHERE staff_resource_id = ${resourceId}
      AND status = 'merged'
    ORDER BY id ASC
    LIMIT 1
  `)
  return survivorId(rows)
}

/**
 * One hop to the surviving card. A miss, a hidden card, and no mapping are
 * the same null. Visibility is the caller's existing patch policy.
 */
export const resolveMergedResource = async (
  db: ResolveReader,
  resourceId: number,
  visibilityWhere: Prisma.patchWhereInput
): Promise<OfficialMirrorResolveHit | null> => {
  const survivor = await lookupMergedSurvivorId(db, resourceId)
  if (!survivor) return null
  const row = await db.patch_resource.findFirst({
    where: {
      id: survivor,
      status: 0,
      section: { in: ['galgame', 'patch'] },
      patch: { status: 0, ...visibilityWhere }
    },
    select: {
      id: true,
      patch_id: true,
      section: true,
      patch: { select: { unique_id: true } }
    }
  })
  const section = row ? asSection(row.section) : null
  if (!row || !section) return null
  return {
    resourceId: row.id,
    patchId: row.patch_id,
    patchUniqueId: row.patch.unique_id,
    section
  }
}
