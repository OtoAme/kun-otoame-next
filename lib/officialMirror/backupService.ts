import { Prisma } from '@prisma/client'
import { runResourceMutation } from '~/app/api/patch/resource/mutation'
import { prisma } from '~/prisma/index'
import type {
  BackupDetail,
  BackupListItem,
  BackupListResponse,
  BackupMutationResult,
  BackupTab
} from '~/types/api/officialMirror'
import type { z } from 'zod'
import type {
  backupDetailSchema,
  backupDismissSchema,
  backupIgnoreSchema,
  backupListSchema,
  backupResourceSchema
} from '~/validations/officialMirror'
import { refreshAfterCommit } from './cache'
import {
  backupBasis,
  backupTime,
  externalLinks,
  linkChangedAt,
  queueTab,
  queueWaitSince,
  type MirrorCard
} from './decide'
import { OfficialMirrorError } from './errors'
import {
  asDate,
  asNumber,
  asText,
  likePattern,
  recordsOf,
  rowCard,
  rowLink
} from './rows'
import { sqlTimestamp, timestampWithoutZone } from './time'

type ListInput = z.infer<typeof backupListSchema>
type Db = Prisma.TransactionClient | typeof prisma

const cardColumns = Prisma.sql`
  r.id, r.name, r.section, r.patch_id, r.download, r.user_id, r.status, r.note,
  r.type, r.language, r.platform, r.publisher_left_at, r.created, r.updated,
  u.name AS publisher_name, u.role AS role,
  p.name AS patch_name, p.unique_id AS patch_unique_id, p.status AS patch_status
`

const linkColumns = (includeContent: boolean) =>
  includeContent
    ? Prisma.sql`l.id, l.resource_id, l.storage, l.content, l.size, l.version, l.sort_order, l.attached_at, l.content_changed_at`
    : Prisma.sql`l.id, l.resource_id, l.storage, '' AS content, '' AS size, l.version, l.sort_order, l.attached_at, l.content_changed_at`

const attachLinks = async (
  db: Db,
  rows: Record<string, unknown>[],
  includeContent: boolean
) => {
  const ids = rows.flatMap((row) => {
    const id = asNumber(row.id)
    return id === null ? [] : [id]
  })
  const linkRows = ids.length
    ? recordsOf(
        await db.$queryRaw(Prisma.sql`
          SELECT ${linkColumns(includeContent)}
          FROM patch_resource_link l
          WHERE l.resource_id IN (${Prisma.join(ids)})
          ORDER BY l.id ASC
        `)
      )
    : []
  const links = linkRows.flatMap((row) => {
    const link = rowLink(row)
    return link ? [link] : []
  })
  return rows.flatMap((row) => {
    const card = rowCard(row, links)
    return card ? [card] : []
  })
}

const loadState = async (db: Db, ids: number[]) => {
  if (!ids.length) return new Map<number, Record<string, unknown>>()
  const rows = recordsOf(
    await db.$queryRaw(Prisma.sql`
      SELECT resource_id, ignored_at, ignored_by_user_id, ignore_reason, rebackup_dismissed_at
      FROM patch_resource_backup_state
      WHERE resource_id IN (${Prisma.join(ids)})
    `)
  )
  return new Map(
    rows.flatMap((row) => {
      const id = asNumber(row.resource_id)
      return id === null ? [] : [[id, row] as const]
    })
  )
}

const queueRows = async (
  db: Db,
  input: { section?: string; search?: string }
) => {
  const filters = [
    Prisma.sql`r.status = 0`,
    Prisma.sql`u.role <= 2`,
    Prisma.sql`r.publisher_left_at IS NULL`,
    Prisma.sql`EXISTS (
      SELECT 1 FROM patch_resource_link l
      WHERE l.resource_id = r.id AND l.storage = 'user'
    )`
  ]
  if (input.section) filters.push(Prisma.sql`r.section = ${input.section}`)
  if (input.search) {
    const pattern = likePattern(input.search)
    filters.push(Prisma.sql`(
      r.name ILIKE ${pattern} ESCAPE '\\'
      OR u.name ILIKE ${pattern} ESCAPE '\\'
      OR p.name ILIKE ${pattern} ESCAPE '\\'
    )`)
  }
  const rows = recordsOf(
    await db.$queryRaw(Prisma.sql`
      SELECT ${cardColumns}
      FROM patch_resource r
      JOIN "user" u ON u.id = r.user_id
      JOIN patch p ON p.id = r.patch_id
      WHERE ${Prisma.join(filters, ' AND ')}
      ORDER BY r.id ASC
    `)
  )
  return attachLinks(db, rows, false)
}

const ageOf = (since: Date | null, now: Date, resourceId: number) =>
  since
    ? {
        resourceId,
        since: since.toISOString(),
        ageMs: Math.max(0, now.getTime() - since.getTime())
      }
    : null

const placed = (
  card: MirrorCard,
  state: Record<string, unknown> | undefined
) => {
  const ignoredAt = asDate(state?.ignored_at)
  const rebackupDismissedAt = asDate(state?.rebackup_dismissed_at)
  const view = { ...card, ignoredAt, rebackupDismissedAt }
  const tab = queueTab(view)
  return { card, state, ignoredAt, rebackupDismissedAt, tab, view }
}

const toItem = (
  entry: ReturnType<typeof placed>,
  tab: BackupTab
): BackupListItem => {
  const external = externalLinks(entry.card)
  const latest = external.reduce<Date | null>((max, link) => {
    const changedAt = linkChangedAt(link)
    if (!changedAt) return max
    return !max || changedAt > max ? changedAt : max
  }, null)
  const since = queueWaitSince(entry.view, tab)
  return {
    resourceId: entry.card.id,
    name: entry.card.name,
    section: entry.card.section === 'patch' ? 'patch' : 'galgame',
    patchId: entry.card.patchId,
    patchUniqueId: entry.card.patchUniqueId,
    patchName: entry.card.patchName,
    publisher: { id: entry.card.userId, name: entry.card.publisherName },
    download: entry.card.download,
    externalLinkCount: external.length,
    latestExternalChangeAt: latest ? latest.toISOString() : null,
    backupAt: backupTime(entry.card)?.toISOString() ?? null,
    tab,
    waitSince: since ? since.toISOString() : null
  }
}

export const listBackupQueue = async (
  input: ListInput,
  now = new Date()
): Promise<BackupListResponse> => {
  const cards = await queueRows(prisma, input)
  const states = await loadState(
    prisma,
    cards.map((card) => card.id)
  )
  const entries = cards.map((card) => placed(card, states.get(card.id)))
  const counts: BackupListResponse['counts'] = {
    unbacked: 0,
    rebackup: 0,
    ignored: 0
  }
  const oldestSince: Record<
    'unbacked' | 'rebackup',
    { at: Date; id: number } | null
  > = { unbacked: null, rebackup: null }
  for (const entry of entries) {
    if (!entry.tab) continue
    counts[entry.tab] += 1
    if (entry.tab === 'ignored') continue
    const since = queueWaitSince(entry.view, entry.tab)
    if (!since) continue
    const current = oldestSince[entry.tab]
    if (
      !current ||
      since < current.at ||
      (since.getTime() === current.at.getTime() && entry.card.id < current.id)
    ) {
      oldestSince[entry.tab] = { at: since, id: entry.card.id }
    }
  }
  const visible = entries.filter((entry) => entry.tab === input.tab)
  visible.sort((left, right) => {
    const download = left.card.download - right.card.download
    const directed = input.sort === 'download_asc' ? download : -download
    return directed || left.card.id - right.card.id
  })
  const start = (input.page - 1) * input.limit
  return {
    items: visible
      .slice(start, start + input.limit)
      .map((entry) => toItem(entry, input.tab)),
    total: visible.length,
    page: input.page,
    limit: input.limit,
    counts,
    oldest: {
      unbacked: oldestSince.unbacked
        ? ageOf(oldestSince.unbacked.at, now, oldestSince.unbacked.id)
        : null,
      rebackup: oldestSince.rebackup
        ? ageOf(oldestSince.rebackup.at, now, oldestSince.rebackup.id)
        : null
    }
  }
}

const loadMutableCard = async (
  tx: Prisma.TransactionClient,
  resourceId: number
) => {
  const locked = recordsOf(
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM patch_resource WHERE id = ${resourceId} FOR UPDATE
    `)
  )
  if (!locked.length) return null
  await tx.$queryRaw(Prisma.sql`
    SELECT id FROM patch_resource_link
    WHERE resource_id = ${resourceId}
    ORDER BY id ASC
    FOR UPDATE
  `)
  await tx.$queryRaw(Prisma.sql`
    SELECT resource_id FROM patch_resource_backup_state
    WHERE resource_id = ${resourceId}
    FOR UPDATE
  `)
  const rows = recordsOf(
    await tx.$queryRaw(Prisma.sql`
      SELECT ${cardColumns}
      FROM patch_resource r
      JOIN "user" u ON u.id = r.user_id
      JOIN patch p ON p.id = r.patch_id
      WHERE r.id = ${resourceId}
    `)
  )
  const cards = await attachLinks(tx, rows, true)
  const card = cards[0]
  if (!card) return null
  const states = await loadState(tx, [resourceId])
  return placed(card, states.get(resourceId))
}

const actorName = async (tx: Prisma.TransactionClient, actorId: number) => {
  const actor = await tx.user.findUnique({
    where: { id: actorId },
    select: { name: true }
  })
  if (!actor) throw new OfficialMirrorError('未找到该管理员')
  return actor.name
}

const writeLog = async (
  tx: Prisma.TransactionClient,
  actorId: number,
  type: 'backup_ignore' | 'backup_unignore' | 'backup_dismiss',
  content: string
) => {
  await tx.admin_log.create({ data: { type, user_id: actorId, content } })
}

const finish = async (
  result: Omit<BackupMutationResult, 'cacheRefreshed'> & {
    uniqueId?: string
    authorId?: number
  },
  operation: string
): Promise<BackupMutationResult> => {
  const cacheRefreshed = result.changed
    ? await refreshAfterCommit(operation, {
        uniqueIds: result.uniqueId ? [result.uniqueId] : [],
        authorIds: result.authorId ? [result.authorId] : []
      })
    : true
  return {
    changed: result.changed,
    resourceId: result.resourceId,
    tab: result.tab,
    cacheRefreshed
  }
}

export const ignoreBackup = async (
  input: z.infer<typeof backupIgnoreSchema>,
  actorId: number
) => {
  try {
    const result = await runResourceMutation(async (tx) => {
      const entry = await loadMutableCard(tx, input.resourceId)
      if (!entry) throw new OfficialMirrorError('未找到对应的资源')
      if (entry.ignoredAt) {
        return {
          changed: false,
          resourceId: entry.card.id,
          tab: 'ignored' as const
        }
      }
      if (entry.tab !== 'unbacked') {
        throw new OfficialMirrorError('只有未备份的卡片可以忽略')
      }
      const reason = input.reason?.trim() ? input.reason.trim() : null
      const now = new Date()
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO patch_resource_backup_state (
          resource_id, ignored_at, ignored_by_user_id, ignore_reason, rebackup_dismissed_at
        )
        VALUES (${entry.card.id}, ${sqlTimestamp(now)}, ${actorId}, ${reason}, NULL)
        ON CONFLICT (resource_id) DO UPDATE SET
          ignored_at = EXCLUDED.ignored_at,
          ignored_by_user_id = EXCLUDED.ignored_by_user_id,
          ignore_reason = EXCLUDED.ignore_reason
      `)
      const name = await actorName(tx, actorId)
      await writeLog(
        tx,
        actorId,
        'backup_ignore',
        `管理员 ${name} 忽略了资源 ${entry.card.id} 的站方备份。${reason ? `理由：${reason}` : '未填写理由。'}`
      )
      return {
        changed: true,
        resourceId: entry.card.id,
        tab: 'ignored' as const,
        uniqueId: entry.card.patchUniqueId,
        authorId: entry.card.userId
      }
    })
    return finish(result, 'backup-ignore')
  } catch (error) {
    if (error instanceof OfficialMirrorError) return error.message
    throw error
  }
}

export const unignoreBackup = async (
  input: z.infer<typeof backupResourceSchema>,
  actorId: number
) => {
  try {
    const result = await runResourceMutation(async (tx) => {
      const entry = await loadMutableCard(tx, input.resourceId)
      if (!entry) throw new OfficialMirrorError('未找到对应的资源')
      if (!entry.ignoredAt) {
        return {
          changed: false,
          resourceId: entry.card.id,
          tab: queueTab({ ...entry.view, ignoredAt: null })
        }
      }
      await tx.$executeRaw(Prisma.sql`
        UPDATE patch_resource_backup_state
        SET ignored_at = NULL, ignored_by_user_id = NULL, ignore_reason = NULL
        WHERE resource_id = ${entry.card.id}
      `)
      const tab = queueTab({ ...entry.view, ignoredAt: null })
      const name = await actorName(tx, actorId)
      await writeLog(
        tx,
        actorId,
        'backup_unignore',
        `管理员 ${name} 撤销了资源 ${entry.card.id} 的备份忽略。`
      )
      return {
        changed: true,
        resourceId: entry.card.id,
        tab,
        uniqueId: entry.card.patchUniqueId,
        authorId: entry.card.userId
      }
    })
    return finish(result, 'backup-unignore')
  } catch (error) {
    if (error instanceof OfficialMirrorError) return error.message
    throw error
  }
}

export const dismissRebackup = async (
  input: z.infer<typeof backupDismissSchema>,
  actorId: number
) => {
  try {
    const result = await runResourceMutation(async (tx) => {
      const entry = await loadMutableCard(tx, input.resourceId)
      if (!entry) throw new OfficialMirrorError('未找到对应的资源')
      if (backupBasis(entry.card) !== input.basis) {
        throw new OfficialMirrorError('预览已变化，请重新核对')
      }
      const reviewedAt = externalLinks(entry.card).reduce<Date | null>(
        (max, link) => {
          const changedAt = linkChangedAt(link)
          if (!changedAt) return max
          return !max || changedAt > max ? changedAt : max
        },
        null
      )
      if (!reviewedAt) throw new OfficialMirrorError('无法确认链接变动时间')
      const covered =
        entry.rebackupDismissedAt !== null &&
        entry.rebackupDismissedAt.getTime() >= reviewedAt.getTime()
      if (entry.tab !== 'rebackup') {
        if (covered) {
          return { changed: false, resourceId: entry.card.id, tab: entry.tab }
        }
        throw new OfficialMirrorError('当前没有需要确认的链接变动')
      }
      if (covered) {
        return { changed: false, resourceId: entry.card.id, tab: entry.tab }
      }
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO patch_resource_backup_state (
          resource_id, ignored_at, ignored_by_user_id, ignore_reason, rebackup_dismissed_at
        )
        VALUES (
          ${entry.card.id}, NULL, NULL, NULL, ${sqlTimestamp(reviewedAt)}
        )
        ON CONFLICT (resource_id) DO UPDATE SET
          rebackup_dismissed_at = CASE
            WHEN patch_resource_backup_state.rebackup_dismissed_at IS NULL
              OR EXCLUDED.rebackup_dismissed_at > patch_resource_backup_state.rebackup_dismissed_at
            THEN EXCLUDED.rebackup_dismissed_at
            ELSE patch_resource_backup_state.rebackup_dismissed_at
          END
      `)
      const name = await actorName(tx, actorId)
      const reviewedLinks = externalLinks(entry.card)
        .map((link) => `${link.id}@${link.version}`)
        .join('、')
      await writeLog(
        tx,
        actorId,
        'backup_dismiss',
        `管理员 ${name} 确认资源 ${entry.card.id} 截至 ${timestampWithoutZone(reviewedAt)} 的外部链接变动无需重新备份。链接 ${reviewedLinks}。`
      )
      return {
        changed: true,
        resourceId: entry.card.id,
        tab: queueTab({ ...entry.view, rebackupDismissedAt: reviewedAt }),
        uniqueId: entry.card.patchUniqueId,
        authorId: entry.card.userId
      }
    })
    return finish(result, 'backup-dismiss')
  } catch (error) {
    if (error instanceof OfficialMirrorError) return error.message
    throw error
  }
}

export const getBackupDetail = async (
  input: z.infer<typeof backupDetailSchema>
): Promise<BackupDetail | string> => {
  const rows = recordsOf(
    await prisma.$queryRaw(Prisma.sql`
      SELECT ${cardColumns},
        b.ignored_at, b.ignored_by_user_id, b.ignore_reason, b.rebackup_dismissed_at
      FROM patch_resource r
      JOIN "user" u ON u.id = r.user_id
      JOIN patch p ON p.id = r.patch_id
      LEFT JOIN patch_resource_backup_state b ON b.resource_id = r.id
      WHERE r.id = ${input.resourceId}
    `)
  )
  const cards = await attachLinks(prisma, rows, true)
  const card = cards[0]
  const row = rows[0]
  if (!card || !row) return '未找到对应的资源'
  const entry = placed(card, row)
  const tab = entry.tab ?? 'unbacked'
  const item = toItem(entry, entry.tab ?? tab)
  return {
    ...item,
    tab: entry.tab ?? item.tab,
    note: card.note,
    links: [...card.links]
      .sort(
        (left, right) => left.sortOrder - right.sortOrder || left.id - right.id
      )
      .map((link) => {
        const changedAt = linkChangedAt(link)
        return {
          id: link.id,
          storage: link.storage,
          content: link.content,
          size: link.size,
          version: link.version,
          sortOrder: link.sortOrder,
          changedAt: changedAt ? changedAt.toISOString() : null,
          backedUpAt:
            link.storage === 'touchgal' && changedAt
              ? changedAt.toISOString()
              : null
        }
      }),
    ignore: entry.ignoredAt
      ? {
          at: entry.ignoredAt.toISOString(),
          byUserId: asNumber(row.ignored_by_user_id),
          reason: asText(row.ignore_reason) || null
        }
      : null,
    rebackupDismissedAt: entry.rebackupDismissedAt
      ? entry.rebackupDismissedAt.toISOString()
      : null,
    basis: backupBasis(card)
  }
}
