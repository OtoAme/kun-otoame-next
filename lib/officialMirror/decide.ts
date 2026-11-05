import { createHash } from 'crypto'
import {
  RESOURCE_NOTE_MAX,
  type OfficialMirrorBlock,
  type OfficialMirrorBlockCode,
  type OfficialMirrorSection,
  type PairClass
} from '~/types/api/officialMirror'

export const BLOCK_MESSAGE: Record<OfficialMirrorBlockCode, string> = {
  staff_not_public: '站方卡片未公开',
  game_not_public: '所属游戏未公开',
  staff_link_not_touchgal: '站方卡片含非资源盘链接',
  staff_case_open: '站方卡片有未结事项',
  note_too_long: '合并后备注超过 10007 字',
  resource_missing: '未找到对应的资源',
  user_handed_over: '用户卡片已交接',
  user_not_public: '用户卡片未公开',
  pair_dismissed: '这一对已被驳回',
  already_merged_other: '已与其他卡片合并',
  survivor_chain: '不能再次合并已留下的卡片',
  not_candidate: '不是可合并的候选',
  basis_stale: '预览已变化，请重新核对',
  not_high_confidence: '不是高置信对',
  content_unconfirmed: '尚未确认两张卡片是同一份内容'
}

export const block = (code: OfficialMirrorBlockCode): OfficialMirrorBlock => ({
  code,
  message: BLOCK_MESSAGE[code]
})

export type MirrorLink = {
  id: number
  resourceId: number
  storage: string
  content: string
  size: string
  code: string
  password: string
  fileHash: string
  version: number
  sortOrder: number
  attachedAt: Date | null
  contentChangedAt: Date | null
}

export type MirrorCard = {
  id: number
  patchId: number
  patchUniqueId: string
  patchName: string
  patchStatus: number
  section: string
  name: string
  note: string
  type: string[]
  language: string[]
  platform: string[]
  status: number
  download: number
  userId: number
  publisherName: string
  role: number
  publisherLeftAt: Date | null
  created: Date
  updated: Date
  links: MirrorLink[]
}

export type MergeRecordFact = {
  userResourceId: number
  staffResourceId: number
  status: 'dismissed' | 'merged'
  patchId: number
  section: string
  detail: unknown
}

export const asSection = (value: string): OfficialMirrorSection | null =>
  value === 'galgame' || value === 'patch' ? value : null

export const linkChangedAt = (
  link: Pick<MirrorLink, 'attachedAt' | 'contentChangedAt'>
) => {
  const times = [link.attachedAt, link.contentChangedAt].flatMap((value) =>
    value && !Number.isNaN(value.getTime()) ? [value.getTime()] : []
  )
  if (!times.length) return null
  return new Date(Math.max(...times))
}

const maxDate = (values: (Date | null)[]) => {
  const times = values.flatMap((value) =>
    value && !Number.isNaN(value.getTime()) ? [value.getTime()] : []
  )
  if (!times.length) return null
  return new Date(Math.max(...times))
}

const minDate = (values: (Date | null)[]) => {
  const times = values.flatMap((value) =>
    value && !Number.isNaN(value.getTime()) ? [value.getTime()] : []
  )
  if (!times.length) return null
  return new Date(Math.min(...times))
}

export const backupTime = (card: Pick<MirrorCard, 'links'>) =>
  maxDate(
    card.links
      .filter((link) => link.storage === 'touchgal')
      .map((link) => linkChangedAt(link))
  )

export const externalLinks = (card: Pick<MirrorCard, 'links'>) =>
  card.links.filter((link) => link.storage === 'user')

/** Queue membership from current facts. Ignored wins over the other tabs. */
export const queueTab = (
  card: Pick<MirrorCard, 'status' | 'role' | 'publisherLeftAt' | 'links'> & {
    ignoredAt: Date | null
    rebackupDismissedAt: Date | null
  }
) => {
  if (card.status !== 0 || card.role > 2 || card.publisherLeftAt) return null
  const external = externalLinks(card)
  if (!external.length) return null
  if (card.ignoredAt) return 'ignored' as const
  const backedUpAt = backupTime(card)
  if (!backedUpAt) return 'unbacked' as const
  const triggered = external.some((link) => {
    const changedAt = linkChangedAt(link)
    if (!changedAt || changedAt <= backedUpAt) return false
    return !card.rebackupDismissedAt || changedAt > card.rebackupDismissedAt
  })
  return triggered ? ('rebackup' as const) : null
}

/** Wait start for 09. Ignore time is not a wait start. */
export const queueWaitSince = (
  card: Pick<MirrorCard, 'links'> & { rebackupDismissedAt: Date | null },
  tab: 'unbacked' | 'rebackup' | 'ignored' | null
) => {
  if (tab === 'unbacked') {
    return minDate(externalLinks(card).map((link) => link.attachedAt))
  }
  if (tab !== 'rebackup') return null
  const backedUpAt = backupTime(card)
  if (!backedUpAt) return null
  return minDate(
    externalLinks(card).map((link) => {
      const changedAt = linkChangedAt(link)
      if (!changedAt || changedAt <= backedUpAt) return null
      if (card.rebackupDismissedAt && changedAt <= card.rebackupDismissedAt) {
        return null
      }
      return changedAt
    })
  )
}

const iso = (value: Date | null) => (value ? value.toISOString() : null)

const stable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = stable((value as Record<string, unknown>)[key])
        return result
      }, {})
  }
  return value
}

export const digestBasis = (facts: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(stable(facts)))
    .digest('hex')

export const backupBasisFacts = (
  card: Pick<MirrorCard, 'id' | 'status' | 'role' | 'publisherLeftAt' | 'links'>
) => ({
  resourceId: card.id,
  status: card.status,
  role: card.role,
  publisherLeftAt: iso(card.publisherLeftAt),
  links: [...card.links]
    .sort((left, right) => left.id - right.id)
    .map((link) => ({
      id: link.id,
      storage: link.storage,
      content: link.content,
      version: link.version,
      sortOrder: link.sortOrder,
      changedAt: iso(linkChangedAt(link))
    }))
})

export const backupBasis = (card: Parameters<typeof backupBasisFacts>[0]) =>
  digestBasis(backupBasisFacts(card))

const sameSet = (left: string[], right: string[]) => {
  if (left.length !== right.length) return false
  const sortedLeft = [...left].sort()
  const sortedRight = [...right].sort()
  return sortedLeft.every((value, index) => value === sortedRight[index])
}

export const mergeNotes = (userNote: string, staffNote: string) => {
  const trimmed = staffNote.trim()
  if (!trimmed || userNote.includes(trimmed)) {
    return {
      note: userNote,
      appended: false,
      blocked: userNote.length > RESOURCE_NOTE_MAX
    }
  }
  const note = `${userNote}${userNote.length ? '\n\n' : ''}站方备份说明：${trimmed}`
  return { note, appended: true, blocked: note.length > RESOURCE_NOTE_MAX }
}

export type CandidatePair = {
  user: MirrorCard
  staff: MirrorCard
  pairClass: PairClass
}

const survivorIds = (records: MergeRecordFact[]) =>
  new Set(
    records
      .filter((record) => record.status === 'merged')
      .map((record) => record.userResourceId)
  )

const recordedPairs = (records: MergeRecordFact[]) =>
  new Set(
    records.map(
      (record) => `${record.userResourceId}:${record.staffResourceId}`
    )
  )

export const isUserCandidateCard = (card: MirrorCard) =>
  card.status === 0 &&
  card.role <= 2 &&
  card.publisherLeftAt === null &&
  asSection(card.section) !== null &&
  externalLinks(card).length > 0

export const isStaffCandidateCard = (card: MirrorCard) =>
  card.role >= 3 && asSection(card.section) !== null

/** Live pairs only. Dismissed, merged and survivor cards are not candidates. */
export const buildCandidates = (
  cards: MirrorCard[],
  records: MergeRecordFact[]
): CandidatePair[] => {
  const survived = survivorIds(records)
  const recorded = recordedPairs(records)
  const users = cards.filter(
    (card) => isUserCandidateCard(card) && !survived.has(card.id)
  )
  const staffCards = cards.filter(
    (card) => isStaffCandidateCard(card) && !survived.has(card.id)
  )
  const staffByGame = new Map<string, MirrorCard[]>()
  for (const staff of staffCards) {
    const key = `${staff.patchId}:${staff.section}`
    const group = staffByGame.get(key) ?? []
    group.push(staff)
    staffByGame.set(key, group)
  }
  const pairs: CandidatePair[] = []
  for (const user of users) {
    const group = staffByGame.get(`${user.patchId}:${user.section}`) ?? []
    for (const staff of group) {
      if (recorded.has(`${user.id}:${staff.id}`)) continue
      pairs.push({ user, staff, pairClass: 'manual' })
    }
  }
  const userCounts = new Map<number, number>()
  const staffCounts = new Map<number, number>()
  for (const pair of pairs) {
    userCounts.set(pair.user.id, (userCounts.get(pair.user.id) ?? 0) + 1)
    staffCounts.set(pair.staff.id, (staffCounts.get(pair.staff.id) ?? 0) + 1)
  }
  return pairs.map((pair) => ({
    ...pair,
    pairClass: isHighConfidence(pair.user, pair.staff, userCounts, staffCounts)
      ? 'high'
      : 'manual'
  }))
}

const isHighConfidence = (
  user: MirrorCard,
  staff: MirrorCard,
  userCounts: Map<number, number>,
  staffCounts: Map<number, number>
) =>
  staff.status === 0 &&
  staff.created > user.created &&
  sameSet(user.type, staff.type) &&
  sameSet(user.language, staff.language) &&
  sameSet(user.platform, staff.platform) &&
  userCounts.get(user.id) === 1 &&
  staffCounts.get(staff.id) === 1

export const pairBlocks = (input: {
  user: MirrorCard
  staff: MirrorCard
  openCaseIds: number[]
  record: MergeRecordFact | null
  userMergedElsewhere: boolean
  staffIsSurvivor: boolean
  userIsSurvivor: boolean
}) => {
  const blocks: OfficialMirrorBlock[] = []
  if (!isUserCandidateCard(input.user) || !isStaffCandidateCard(input.staff)) {
    blocks.push(block('not_candidate'))
  }
  if (
    input.user.patchId !== input.staff.patchId ||
    input.user.section !== input.staff.section
  ) {
    blocks.push(block('not_candidate'))
  }
  if (input.user.publisherLeftAt) blocks.push(block('user_handed_over'))
  if (input.user.status !== 0) blocks.push(block('user_not_public'))
  if (input.staff.status !== 0) blocks.push(block('staff_not_public'))
  if (input.staff.patchStatus !== 0 || input.user.patchStatus !== 0) {
    blocks.push(block('game_not_public'))
  }
  if (input.staff.links.some((link) => link.storage !== 'touchgal')) {
    blocks.push(block('staff_link_not_touchgal'))
  }
  if (input.openCaseIds.length) blocks.push(block('staff_case_open'))
  if (mergeNotes(input.user.note, input.staff.note).blocked) {
    blocks.push(block('note_too_long'))
  }
  if (input.record?.status === 'dismissed') blocks.push(block('pair_dismissed'))
  if (input.userMergedElsewhere || input.userIsSurvivor) {
    blocks.push(block('already_merged_other'))
  }
  if (input.staffIsSurvivor) blocks.push(block('survivor_chain'))
  const seen = new Set<string>()
  return blocks.filter((item) => {
    if (seen.has(item.code)) return false
    seen.add(item.code)
    return true
  })
}

export type OpenCaseFact = {
  id: number
  targetType: string
  targetId: number
  status: string
  revision: number
}

export const mergeBasisFacts = (input: {
  user: MirrorCard
  staff: MirrorCard
  openCases: OpenCaseFact[]
}) => ({
  user: cardBasis(input.user),
  staff: cardBasis(input.staff),
  openCases: [...input.openCases].sort((left, right) => left.id - right.id)
})

const cardBasis = (card: MirrorCard) => ({
  id: card.id,
  updatedAt: card.updated.toISOString(),
  userId: card.userId,
  role: card.role,
  status: card.status,
  publisherLeftAt: iso(card.publisherLeftAt),
  patchId: card.patchId,
  patchStatus: card.patchStatus,
  section: card.section,
  name: card.name,
  note: card.note,
  type: [...card.type].sort(),
  language: [...card.language].sort(),
  platform: [...card.platform].sort(),
  links: [...card.links]
    .sort((left, right) => left.id - right.id)
    .map((link) => ({
      id: link.id,
      storage: link.storage,
      content: link.content,
      code: link.code,
      password: link.password,
      fileHash: link.fileHash,
      size: link.size,
      version: link.version,
      sortOrder: link.sortOrder,
      attachedAt: iso(link.attachedAt),
      changedAt: iso(linkChangedAt(link))
    }))
})

export const mergeBasis = (input: Parameters<typeof mergeBasisFacts>[0]) =>
  digestBasis(mergeBasisFacts(input))

export type GrantRow = {
  actorKey: string
  resourceId: number
  expires: Date
}

export type GrantAction = {
  actorKey: string
  kind: 'move' | 'keep-max'
  expires: Date
}

/** Keep the later existing expiry. Never start a new 24 hour window. */
export const planGrants = (
  userResourceId: number,
  staffResourceId: number,
  grants: GrantRow[]
): GrantAction[] => {
  const byActor = new Map<string, { user?: GrantRow; staff?: GrantRow }>()
  for (const grant of grants) {
    const slot = byActor.get(grant.actorKey) ?? {}
    if (grant.resourceId === userResourceId) slot.user = grant
    if (grant.resourceId === staffResourceId) slot.staff = grant
    byActor.set(grant.actorKey, slot)
  }
  const actions: GrantAction[] = []
  for (const actorKey of [...byActor.keys()].sort()) {
    const slot = byActor.get(actorKey)
    if (!slot?.staff) continue
    if (!slot.user) {
      actions.push({ actorKey, kind: 'move', expires: slot.staff.expires })
      continue
    }
    actions.push({
      actorKey,
      kind: 'keep-max',
      expires:
        slot.staff.expires > slot.user.expires
          ? slot.staff.expires
          : slot.user.expires
    })
  }
  return actions
}

/** Reader order. Row locks stay by id and must not be reused as this order. */
export const compareLinkDisplayOrder = (
  left: Pick<MirrorLink, 'sortOrder' | 'id'>,
  right: Pick<MirrorLink, 'sortOrder' | 'id'>
) => left.sortOrder - right.sortOrder || left.id - right.id

export const movedLinkSorts = (user: MirrorCard, staff: MirrorCard) => {
  const start =
    user.links.reduce((max, link) => Math.max(max, link.sortOrder), -1) + 1
  return [...staff.links].sort(compareLinkDisplayOrder).map((link, index) => ({
    id: link.id,
    version: link.version,
    sortOrder: start + index
  }))
}

export const MERGE_DETAIL_KEYS = [
  'movedLinkIds',
  'noteAppended',
  'contentConfirmed',
  'basis',
  'sourceAuthorId',
  'likeCount',
  'userResourceId',
  'staffResourceId'
] as const

export type MergeDetail = {
  movedLinkIds: number[]
  noteAppended: boolean
  contentConfirmed: true
  basis: string
  sourceAuthorId: number
  likeCount: number
  userResourceId: number
  staffResourceId: number
}

export const toMergeDetail = (input: MergeDetail): MergeDetail => ({
  movedLinkIds: input.movedLinkIds,
  noteAppended: input.noteAppended,
  contentConfirmed: true,
  basis: input.basis,
  sourceAuthorId: input.sourceAuthorId,
  likeCount: input.likeCount,
  userResourceId: input.userResourceId,
  staffResourceId: input.staffResourceId
})

export const pairWaitSince = (user: MirrorCard, staff: MirrorCard) =>
  user.created > staff.created ? user.created : staff.created

export const CLOSED_CASE_STATUSES = ['resolved', 'rejected'] as const
export const OPEN_CASE_STATUSES = [
  'open',
  'waiting_reporter',
  'waiting_owner'
] as const
