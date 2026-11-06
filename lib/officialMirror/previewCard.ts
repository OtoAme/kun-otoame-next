import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { getPublicResourceCaseBadges } from '~/app/api/case/service'
import {
  getLinkDisputeSources,
  linkHealthSelect,
  projectLinkHealth
} from '~/app/api/patch/resource/linkHealthProjection'
import { recognizeResourceDiskKind } from '~/utils/resourceDiskKind'
import { mergePairSchema } from '~/validations/officialMirror'
import { previewResourceMerge } from './mergeService'
import type {
  PatchResourceHealth,
  PatchResourceHealthLink
} from '~/types/api/patch'
import type { MergePreview } from '~/types/api/officialMirror'

/**
 * Server-only readers for the admin preview pages under
 * `app/(preview)/preview/resource-card` and `app/(preview)/preview/resource-merge`.
 * The module reads the database and must never be imported by client code.
 *
 * A preview card is the public projection of `getPatchResource`
 * (app/api/patch/resource/get.ts) for one card of any status, read as an
 * anonymous viewer: no access grants, no revealed or obtained state, no like
 * state of the admin. The link address stays (the preview renders it like the
 * merge page does); 提取码 and 解压码 are never part of the result.
 */
export type PreviewCardLink = Omit<
  PatchResourceHealthLink,
  'revealed' | 'revealedExpiresAt' | 'obtained' | 'obtainedExpiresAt'
> & {
  content: string
  code?: never
  password?: never
}

export type PreviewCard = Omit<PatchResourceHealth, 'links' | 'isLike'> & {
  links: PreviewCardLink[]
  isLike: false
}

export type MergeSurvivorPreview = MergePreview['survivorPreview']

/** Health capabilities are computed for nobody: preview cards carry no actions. */
const PREVIEW_VIEWER = { uid: 0, role: 0 }

const previewResourceIdSchema = z
  .string()
  .regex(/^[1-9]\d{0,6}$/)
  .transform(Number)

/** Strict route parameter: a decimal resource id in the mirror id range. */
export const parsePreviewResourceId = (raw: unknown): number | null => {
  const parsed = previewResourceIdSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

/** `?user=<id>&staff=<id>`; repeated, missing or equal ids are invalid. */
export const parseMergePreviewQuery = (query: {
  user?: string | string[]
  staff?: string | string[]
}): z.infer<typeof mergePairSchema> | null => {
  const userResourceId = parsePreviewResourceId(query.user)
  const staffResourceId = parsePreviewResourceId(query.staff)
  if (userResourceId === null || staffResourceId === null) return null
  if (userResourceId === staffResourceId) return null
  const parsed = mergePairSchema.safeParse({ userResourceId, staffResourceId })
  return parsed.success ? parsed.data : null
}

// Same backup-time rules as getPatchResource: only touchgal links carry a
// backup time, which is the later of attach and content change.
const asDate = (value: Date | string | null | undefined) => {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const laterDate = (left: Date | null, right: Date | null) => {
  if (left && right) return left > right ? left : right
  return left ?? right
}

const isoOrNull = (value: Date | null) => (value ? value.toISOString() : null)

const linkChangeTime = (
  storage: string,
  attachedAt: Date | null,
  contentChangedAt: Date | null
) => (storage === 'touchgal' ? laterDate(attachedAt, contentChangedAt) : null)

const latestIso = (values: (string | null | undefined)[]) =>
  values.reduce<string | null>((max, value) => {
    if (typeof value !== 'string') return max
    const time = Date.parse(value)
    if (Number.isNaN(time)) return max
    return max !== null && Date.parse(max) >= time ? max : value
  }, null)

/**
 * Preview projections of the given cards, keyed by id. Any status, any game
 * visibility; ids that do not exist are absent from the map.
 */
export const loadPreviewResourceCards = async (
  resourceIds: number[],
  now = new Date()
): Promise<Map<number, PreviewCard>> => {
  const ids = [...new Set(resourceIds)]
  const cards = new Map<number, PreviewCard>()
  if (!ids.length) return cards

  const data = await prisma.patch_resource.findMany({
    where: { id: { in: ids } },
    include: {
      patch: { select: { unique_id: true } },
      user: {
        select: {
          id: true,
          name: true,
          avatar: true,
          role: true,
          _count: { select: { patch_resource: true } }
        }
      },
      links: {
        select: {
          ...linkHealthSelect(now),
          attached_at: true
        },
        orderBy: { sort_order: 'asc' }
      },
      _count: {
        select: { like_by: true }
      }
    }
  })

  const disputeSources = await getLinkDisputeSources(
    data.flatMap((resource) =>
      resource.links.map((link) => ({
        ...link,
        resourceId: resource.id,
        patchId: resource.patch_id
      }))
    )
  )
  const caseSummaries = await getPublicResourceCaseBadges(
    data.map((resource) => resource.id),
    { db: prisma }
  )

  for (const resource of data) {
    const links: PreviewCardLink[] = resource.links.map((link) => {
      const changeTime = linkChangeTime(
        link.storage,
        asDate(link.attached_at),
        asDate(link.content_changed_at)
      )
      return {
        ...projectLinkHealth(
          link,
          resource.user_id,
          PREVIEW_VIEWER,
          disputeSources.get(link.id) ?? null,
          now
        ),
        id: link.id,
        storage: link.storage,
        size: link.size,
        hash: link.hash,
        diskKind: recognizeResourceDiskKind(link.content, link.storage),
        sortOrder: link.sort_order,
        download: link.download,
        backedUpAt: isoOrNull(changeTime),
        content: link.content
      }
    })

    cards.set(resource.id, {
      id: resource.id,
      name: resource.name,
      section: resource.section,
      uniqueId: resource.patch.unique_id,
      type: resource.type,
      language: resource.language,
      note: resource.note,
      platform: resource.platform,
      links,
      download: resource.download,
      likeCount: resource._count.like_by,
      isLike: false,
      status: resource.status,
      userId: resource.user_id,
      patchId: resource.patch_id,
      caseSummaries: caseSummaries.get(resource.id) ?? [],
      created: String(resource.created),
      publisherLeftAt: isoOrNull(asDate(resource.publisher_left_at)),
      hasStaffBackup: links.some((link) => link.storage === 'touchgal'),
      backedUpAt: latestIso(links.map((link) => link.backedUpAt)),
      user: {
        id: resource.user.id,
        name: resource.user.name,
        avatar: resource.user.avatar,
        patchCount: resource.user._count.patch_resource,
        role: resource.user.role
      }
    })
  }

  return cards
}

export const loadPreviewResourceCard = async (
  resourceId: number,
  now = new Date()
): Promise<PreviewCard | null> =>
  (await loadPreviewResourceCards([resourceId], now)).get(resourceId) ?? null

/**
 * The survivor as the public card would show it after the merge: name,
 * attributes, note and link order from the merge preview; each link keeps the
 * projection (health, disk kind, backup time) of the card it comes from, with
 * the survivor sort order. Publisher, likes, created time and cases stay the
 * user card's; downloads are summed like the merge does. Returns null when a
 * listed link is no longer on either card (the two reads disagree).
 */
export const composeMergeSurvivorCard = (
  survivor: MergeSurvivorPreview,
  user: PreviewCard,
  staff: PreviewCard
): PreviewCard | null => {
  const projected = new Map(
    [...user.links, ...staff.links].map((link) => [link.id, link] as const)
  )
  const links: PreviewCardLink[] = []
  for (const view of survivor.links) {
    const link = projected.get(view.id)
    if (!link) return null
    links.push({ ...link, sortOrder: view.sortOrder })
  }
  return {
    ...user,
    name: survivor.name,
    type: survivor.type,
    language: survivor.language,
    platform: survivor.platform,
    note: survivor.note,
    links,
    download: user.download + staff.download,
    hasStaffBackup: links.some((link) => link.storage === 'touchgal'),
    backedUpAt: latestIso(links.map((link) => link.backedUpAt))
  }
}

/** Null for a merge preview error, a missing card or a stale link list. */
export const loadMergeSurvivorCard = async (
  input: z.infer<typeof mergePairSchema>,
  now = new Date()
): Promise<PreviewCard | null> => {
  const [preview, cards] = await Promise.all([
    previewResourceMerge(input),
    loadPreviewResourceCards([input.userResourceId, input.staffResourceId], now)
  ])
  if (typeof preview === 'string') return null
  const user = cards.get(input.userResourceId)
  const staff = cards.get(input.staffResourceId)
  if (!user || !staff) return null
  return composeMergeSurvivorCard(preview.survivorPreview, user, staff)
}
