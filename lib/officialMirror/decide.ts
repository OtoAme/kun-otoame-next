import { createHash } from 'crypto'
import {
  MERGE_RECOMMEND_LEAD,
  MERGE_RECOMMEND_MIN_ATTRIBUTES,
  MERGE_SIZE_TOLERANCE,
  RESOURCE_NOTE_MAX,
  type MergeRecommendState,
  type MergeSignal,
  type MergeSignalCheck,
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
  section_mismatch: '与用户资源不在同一分区，不能合并',
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
  handledAt: Date | null
  handledByUserId: number | null
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
  'staffResourceId',
  'recommended'
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
  /**
   * Statistics only: the pair was the recommendation when it was merged.
   * Records written before this key existed omit it.
   */
  recommended?: boolean
}

export const toMergeDetail = (input: MergeDetail): MergeDetail => ({
  movedLinkIds: input.movedLinkIds,
  noteAppended: input.noteAppended,
  contentConfirmed: true,
  basis: input.basis,
  sourceAuthorId: input.sourceAuthorId,
  likeCount: input.likeCount,
  userResourceId: input.userResourceId,
  staffResourceId: input.staffResourceId,
  ...(typeof input.recommended === 'boolean'
    ? { recommended: input.recommended }
    : {})
})

export const pairWaitSince = (user: MirrorCard, staff: MirrorCard) =>
  user.created > staff.created ? user.created : staff.created

export const CLOSED_CASE_STATUSES = ['resolved', 'rejected'] as const
export const OPEN_CASE_STATUSES = [
  'open',
  'waiting_reporter',
  'waiting_owner'
] as const

/* Merge option ranking. Ordering and recommendation only; never acceptance. */

const SIZE_PATTERN = /^(\d+(?:\.\d+)?) ?([kmgt])b$/i
const SIZE_TO_MB: Record<string, number> = {
  k: 1 / 1024,
  m: 1,
  g: 1024,
  t: 1024 * 1024
}

/** `<number><optional space><k|m|g|t>b`, case-insensitive, in MB. Zero is unparseable. */
export const parseSizeMb = (value: string) => {
  const match = SIZE_PATTERN.exec(value.trim())
  if (!match) return null
  const mb = Number(match[1]) * SIZE_TO_MB[match[2].toLowerCase()]
  return Number.isFinite(mb) && mb > 0 ? mb : null
}

/** Relative difference against the larger value; the epsilon absorbs float noise. */
export const sizesClose = (left: number, right: number) =>
  Math.abs(left - right) <=
  MERGE_SIZE_TOLERANCE * Math.max(left, right) * (1 + 1e-9)

const NAME_NOISE = /[\s\p{P}$+<=>^`|~]/gu

/** NFKC, lower case, no whitespace, no ASCII or CJK punctuation. */
export const normalizeMergeName = (value: string) =>
  value.normalize('NFKC').toLowerCase().replace(NAME_NOISE, '')

const sameValues = (left: string[], right: string[]) => {
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  if (leftSet.size !== rightSet.size) return false
  return [...leftSet].every((value) => rightSet.has(value))
}

export type CandidateCounts = {
  users: Map<number, number>
  staff: Map<number, number>
}

/** Live pair counts per side, the same counts `buildCandidates` uses for high. */
export const candidateCounts = (pairs: CandidatePair[]): CandidateCounts => {
  const users = new Map<number, number>()
  const staff = new Map<number, number>()
  for (const pair of pairs) {
    users.set(pair.user.id, (users.get(pair.user.id) ?? 0) + 1)
    staff.set(pair.staff.id, (staff.get(pair.staff.id) ?? 0) + 1)
  }
  return { users, staff }
}

const sizeStrings = (links: MirrorLink[]) =>
  links.map((link) => link.size).filter((size) => size.trim().length > 0)

const sizeHit = (user: MirrorCard, staff: MirrorCard) => {
  const userSizes = externalLinks(user).flatMap((link) => {
    const mb = parseSizeMb(link.size)
    return mb === null ? [] : [mb]
  })
  const staffSizes = staff.links.flatMap((link) => {
    const mb = parseSizeMb(link.size)
    return mb === null ? [] : [mb]
  })
  return userSizes.some((left) =>
    staffSizes.some((right) => sizesClose(left, right))
  )
}

const nameHit = (user: MirrorCard, staff: MirrorCard) => {
  const left = normalizeMergeName(user.name)
  const right = normalizeMergeName(staff.name)
  return (
    left.length > 0 &&
    right.length > 0 &&
    (left.includes(right) || right.includes(left))
  )
}

/** Signals in `MERGE_SIGNALS` order. */
export const mergeSignals = (
  user: MirrorCard,
  staff: MirrorCard,
  counts: CandidateCounts
): MergeSignalCheck[] => {
  const userCount = counts.users.get(user.id) ?? 0
  const staffCount = counts.staff.get(staff.id) ?? 0
  const check = (
    signal: MergeSignal,
    hit: boolean,
    userValues: string[],
    staffValues: string[]
  ): MergeSignalCheck => ({
    signal,
    hit,
    user: userValues,
    staff: staffValues
  })
  return [
    check(
      'type',
      sameValues(user.type, staff.type),
      [...user.type],
      [...staff.type]
    ),
    check(
      'language',
      sameValues(user.language, staff.language),
      [...user.language],
      [...staff.language]
    ),
    check(
      'platform',
      sameValues(user.platform, staff.platform),
      [...user.platform],
      [...staff.platform]
    ),
    check(
      'size',
      sizeHit(user, staff),
      sizeStrings(externalLinks(user)),
      sizeStrings(staff.links)
    ),
    check('name', nameHit(user, staff), [user.name], [staff.name]),
    check(
      'later',
      staff.created > user.created,
      [user.created.toISOString()],
      [staff.created.toISOString()]
    ),
    check(
      'unique',
      userCount === 1 && staffCount === 1,
      [String(userCount)],
      [String(staffCount)]
    )
  ]
}

const ATTRIBUTE_SIGNALS: readonly MergeSignal[] = [
  'type',
  'language',
  'platform'
]

export const signalHits = (signals: MergeSignalCheck[]) =>
  signals.filter((item) => item.hit).length

export const attributeHits = (signals: MergeSignalCheck[]) =>
  signals.filter((item) => item.hit && ATTRIBUTE_SIGNALS.includes(item.signal))
    .length

export type MergeRankEntry = {
  staffId: number
  sameSection: boolean
  /** Same section, no block, no record, user card eligible. */
  mergeable: boolean
  signals: MergeSignalCheck[]
}

export type MergeRanking<T> = {
  state: MergeRecommendState
  recommendedStaffId: number | null
  /** Recommended, other mergeable, other same-section, other section. */
  ordered: T[]
}

/**
 * Recommendation over mergeable options. The leader is the highest hits;
 * a tie prefers more attribute hits, then the lower staff id. A tie at the
 * top is never recommended.
 */
export const rankMergeOptions = <T extends MergeRankEntry>(
  entries: T[]
): MergeRanking<T> => {
  const hits = new Map(
    entries.map((entry) => [entry, signalHits(entry.signals)])
  )
  const hitsOf = (entry: T) => hits.get(entry) ?? 0
  const contenders = entries
    .filter((entry) => entry.mergeable && entry.sameSection)
    .sort(
      (left, right) =>
        hitsOf(right) - hitsOf(left) ||
        attributeHits(right.signals) - attributeHits(left.signals) ||
        left.staffId - right.staffId
    )
  let state: MergeRecommendState = 'none'
  let recommended: T | null = null
  const leader = contenders[0]
  if (leader) {
    const enough =
      attributeHits(leader.signals) >= MERGE_RECOMMEND_MIN_ATTRIBUTES
    const runnerUp = contenders[1]
    if (!runnerUp) {
      state = enough ? 'recommended' : 'insufficient'
    } else {
      const lead = hitsOf(leader) - hitsOf(runnerUp)
      if (enough && lead > 0 && lead >= MERGE_RECOMMEND_LEAD) {
        state = 'recommended'
      } else {
        state = enough ? 'close' : 'insufficient'
      }
    }
    if (state === 'recommended') recommended = leader
  }
  const groupOf = (entry: T) => {
    if (entry.mergeable && entry.sameSection) return 0
    return entry.sameSection ? 1 : 2
  }
  const rest = entries
    .filter((entry) => entry !== recommended)
    .sort(
      (left, right) =>
        groupOf(left) - groupOf(right) ||
        hitsOf(right) - hitsOf(left) ||
        left.staffId - right.staffId
    )
  return {
    state,
    recommendedStaffId: recommended ? recommended.staffId : null,
    ordered: recommended ? [recommended, ...rest] : rest
  }
}

/** Candidate and record facts shared by the list, options and merge statistics. */
export type MergeFacts = {
  records: MergeRecordFact[]
  candidates: CandidatePair[]
  counts: CandidateCounts
  recordByPair: Map<string, MergeRecordFact>
  pairClassByPair: Map<string, PairClass>
  /** User card ids that already survived a merge. */
  survivors: Set<number>
}

const pairKey = (userResourceId: number, staffResourceId: number) =>
  `${userResourceId}:${staffResourceId}`

export const mergeFacts = (
  cards: MirrorCard[],
  records: MergeRecordFact[]
): MergeFacts => {
  const candidates = buildCandidates(cards, records)
  return {
    records,
    candidates,
    counts: candidateCounts(candidates),
    recordByPair: new Map(
      records.map((record) => [
        pairKey(record.userResourceId, record.staffResourceId),
        record
      ])
    ),
    pairClassByPair: new Map(
      candidates.map((pair) => [
        pairKey(pair.user.id, pair.staff.id),
        pair.pairClass
      ])
    ),
    survivors: survivorIds(records)
  }
}

/** Blocks for one pair from shared facts; same inputs as preview and merge. */
export const factPairBlocks = (
  facts: MergeFacts,
  user: MirrorCard,
  staff: MirrorCard,
  openCaseIds: number[]
) =>
  pairBlocks({
    user,
    staff,
    openCaseIds,
    record: facts.recordByPair.get(pairKey(user.id, staff.id)) ?? null,
    userMergedElsewhere: facts.records.some(
      (item) =>
        item.status === 'merged' &&
        item.userResourceId === user.id &&
        item.staffResourceId !== staff.id
    ),
    staffIsSurvivor: facts.survivors.has(staff.id),
    userIsSurvivor: facts.survivors.has(user.id)
  })

/** User-side candidate rule and not already a survivor. */
export const isEligibleUserCard = (facts: MergeFacts, user: MirrorCard) =>
  isUserCandidateCard(user) && !facts.survivors.has(user.id)

export type MergeOptionFact = MergeRankEntry & {
  staff: MirrorCard
  hits: number
  highConfidence: boolean
  /** A dismiss request would write a record now. */
  dismissable: boolean
  blocks: OfficialMirrorBlock[]
  record: MergeRecordFact | null
}

/**
 * Every staff card offered to one user card, ranked. Other-section cards are
 * listed with `section_mismatch` and never mergeable.
 */
export const assessMergeOptions = (input: {
  user: MirrorCard
  staffCards: MirrorCard[]
  facts: MergeFacts
  openCaseIds: (staffId: number) => number[]
}) => {
  const { user, facts } = input
  const eligible = isEligibleUserCard(facts, user)
  const options = input.staffCards
    .filter(
      (staff) =>
        staff.id !== user.id &&
        staff.patchId === user.patchId &&
        isStaffCandidateCard(staff)
    )
    .map((staff): MergeOptionFact => {
      const sameSection = staff.section === user.section
      const record = facts.recordByPair.get(pairKey(user.id, staff.id)) ?? null
      const blocks = sameSection
        ? factPairBlocks(facts, user, staff, input.openCaseIds(staff.id))
        : [block('section_mismatch')]
      const signals = mergeSignals(user, staff, facts.counts)
      return {
        staffId: staff.id,
        staff,
        sameSection,
        signals,
        hits: signalHits(signals),
        highConfidence:
          facts.pairClassByPair.get(pairKey(user.id, staff.id)) === 'high',
        mergeable: sameSection && eligible && !record && blocks.length === 0,
        dismissable:
          sameSection && eligible && !record && !facts.survivors.has(staff.id),
        blocks,
        record
      }
    })
  const ranking = rankMergeOptions(options)
  return {
    eligible,
    state: ranking.state,
    recommendedStaffId: ranking.recommendedStaffId,
    options: ranking.ordered
  }
}
