import { prisma } from '~/prisma/index'
import { LINK_HEALTH_POLICY as P } from '~/constants/linkHealth'
import { CASE_UNRESOLVED_STATUSES } from '~/constants/case'
import {
  getLinkDisputeSources,
  linkHealthSelect,
  projectLinkHealth
} from '../linkHealthProjection'
import type { Prisma } from '@prisma/client'
import type {
  AdminLinkHealthListResponse,
  AdminLinkHealthQuery,
  LinkHealthListResponse,
  LinkHealthQuery,
  LinkHealthListRow
} from '~/types/api/linkHealth'
import type { HealthActor } from './service'

const select = (now: Date) =>
  ({
    ...linkHealthSelect(now),
    resource_id: true,
    resource: {
      select: {
        user_id: true,
        name: true,
        section: true,
        patch_id: true,
        links: { select: { storage: true } },
        patch: { select: { name: true, unique_id: true } }
      }
    }
  }) satisfies Prisma.patch_resource_linkSelect
type ReadRow = Prisma.patch_resource_linkGetPayload<{
  select: ReturnType<typeof select>
}>
export const linkHostname = (content: string) => {
  try {
    const url = new URL(content)
    return ['http:', 'https:'].includes(url.protocol)
      ? url.hostname.toLowerCase()
      : null
  } catch {
    return null
  }
}
const compare = (a: ReadRow, b: ReadRow) =>
  (a.health_changed_at?.getTime() ?? Infinity) -
    (b.health_changed_at?.getTime() ?? Infinity) || a.id - b.id
export const projectHealthRows = async (
  rows: ReadRow[],
  actor: HealthActor,
  now: Date
): Promise<LinkHealthListRow[]> => {
  const sources = await getLinkDisputeSources(
    rows.map((row) => ({
      ...row,
      resourceId: row.resource_id,
      patchId: row.resource.patch_id
    }))
  )
  const active = rows.length
    ? await prisma.ops_case.findMany({
        where: {
          target_type: 'link',
          source: 'system',
          reporter_id: null,
          kind: { in: ['link_suspect', 'link_disputed'] },
          status: { in: [...CASE_UNRESOLVED_STATUSES] },
          OR: rows.map((row) => ({
            target_id: row.id,
            dedup_key: `link:${row.id}:v:${row.version}`
          }))
        },
        select: { id: true, target_id: true, dedup_key: true }
      })
    : []
  const caseIds = new Map(
    active
      .filter((item) =>
        rows.some(
          (row) =>
            row.id === item.target_id &&
            item.dedup_key === `link:${row.id}:v:${row.version}`
        )
      )
      .map((item) => [item.target_id, item.id])
  )
  return rows.map((row) => ({
    patchId: row.resource.patch_id,
    resourceId: row.resource_id,
    linkId: row.id,
    ...projectLinkHealth(
      row,
      row.resource.user_id,
      actor,
      sources.get(row.id) ?? null,
      now
    ),
    patch: {
      uniqueId: row.resource.patch.unique_id,
      name: row.resource.patch.name
    },
    resource: { name: row.resource.name, section: row.resource.section },
    storage: row.storage,
    size: row.size,
    hostname: linkHostname(row.content),
    brokenForSeconds:
      row.health === 'broken' && row.health_changed_at
        ? Math.max(
            0,
            Math.floor((now.getTime() - row.health_changed_at.getTime()) / 1000)
          )
        : null,
    caseId: caseIds.get(row.id) ?? null
  }))
}
export const listPublisherLinks = async (
  input: LinkHealthQuery,
  actor: HealthActor,
  visibility: Prisma.patchWhereInput
): Promise<LinkHealthListResponse> => {
  const now = new Date()
  const where: Prisma.patch_resource_linkWhereInput = {
    health: { not: 'ok' },
    storage: { not: P.staffStorage },
    resource: {
      user_id: actor.uid,
      status: 0,
      patch: { status: 0, ...visibility }
    }
  }
  const [rows, total] = await Promise.all([
    prisma.patch_resource_link.findMany({
      where,
      orderBy: [
        { health_changed_at: { sort: 'asc', nulls: 'last' } },
        { id: 'asc' }
      ],
      skip: (input.page - 1) * input.limit,
      take: input.limit,
      select: select(now)
    }),
    prisma.patch_resource_link.count({ where })
  ])
  return {
    items: await projectHealthRows(rows, actor, now),
    total,
    page: input.page,
    limit: input.limit
  }
}
export const listAdminLinks = async (
  input: AdminLinkHealthQuery,
  actor: HealthActor
): Promise<AdminLinkHealthListResponse> => {
  const now = new Date()
  const [rows, population] = await Promise.all([
    prisma.patch_resource_link.findMany({
      where: { health: 'broken' },
      select: select(now)
    }),
    prisma.patch_resource_link.findMany({
      select: { content: true, health: true }
    })
  ])
  const selected = rows
    .filter((row) => {
      const host = linkHostname(row.content)
      const has = row.resource.links.some(
        (link) => link.storage === P.staffStorage
      )
      return (
        (!input.ownerType ||
          (row.storage === P.staffStorage ? 'staff' : 'publisher') ===
            input.ownerType) &&
        (input.hasTouchgalLink === undefined ||
          has === input.hasTouchgalLink) &&
        (!input.hostname || host === input.hostname) &&
        (!input.otherHost || host === null) &&
        (input.minBrokenDays === undefined ||
          (row.health_changed_at !== null &&
            now.getTime() - row.health_changed_at.getTime() >=
              input.minBrokenDays * 86400000))
      )
    })
    .sort(compare)
  const hosts = new Map<
    string | null,
    { hostname: string | null; totalLinks: number; brokenLinks: number }
  >()
  for (const link of population) {
    const hostname = linkHostname(link.content)
    const bucket = hosts.get(hostname) ?? {
      hostname,
      totalLinks: 0,
      brokenLinks: 0
    }
    bucket.totalLinks++
    if (link.health === 'broken') bucket.brokenLinks++
    hosts.set(hostname, bucket)
  }
  const configured = process.env.KUN_LINK_HEALTH_TRACKING_STARTED_AT
  const trackingStartedAt =
    configured &&
    /^\d{4}-\d{2}-\d{2}T/.test(configured) &&
    Number.isFinite(Date.parse(configured))
      ? new Date(configured).toISOString()
      : null
  return {
    items: await projectHealthRows(
      selected.slice((input.page - 1) * input.limit, input.page * input.limit),
      actor,
      now
    ),
    total: selected.length,
    page: input.page,
    limit: input.limit,
    trackingStartedAt,
    hosts: [...hosts.values()].sort((a, b) =>
      (a.hostname ?? '').localeCompare(b.hostname ?? '')
    )
  }
}
/** One selection shared by pending counts, lists and item checks. */
export const loadBrokenInboxRows = async (search = '', now = new Date()) => {
  const rows = await prisma.patch_resource_link.findMany({
    where: {
      storage: P.staffStorage,
      health: 'broken',
      health_changed_at: { not: null }
    },
    select: select(now)
  })
  if (!rows.length) return []
  const unresolved = await prisma.ops_case.findMany({
    where: {
      target_type: 'link',
      target_id: { in: rows.map((row) => row.id) },
      kind: { in: ['link_suspect', 'link_disputed'] },
      status: { in: [...CASE_UNRESOLVED_STATUSES] }
    },
    select: { target_id: true }
  })
  const occupied = new Set(unresolved.map((row) => row.target_id))
  const needle = search.trim().toLowerCase()
  return rows
    .filter(
      (row) =>
        !occupied.has(row.id) &&
        (!needle ||
          String(row.id) === needle.replace(/^#/, '') ||
          [
            row.resource.name,
            row.resource.patch.name,
            linkHostname(row.content) ?? ''
          ].some((text) => text.toLowerCase().includes(needle)))
    )
    .sort(compare)
}
export const loadInboxLink = (id: number, now = new Date()) =>
  prisma.patch_resource_link.findUnique({ where: { id }, select: select(now) })
