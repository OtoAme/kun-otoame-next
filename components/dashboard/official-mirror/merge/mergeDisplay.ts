import {
  RESOURCE_SECTION_MAP,
  SUPPORTED_LANGUAGE_MAP,
  SUPPORTED_PLATFORM_MAP,
  SUPPORTED_RESOURCE_LINK_MAP,
  SUPPORTED_TYPE_MAP
} from '~/constants/resource'
import { formatChinaDateTime } from '~/utils/fixedTimezoneDate'
import type {
  MergeListItem,
  MergeOption,
  MergePreview,
  MergeSignal,
  MergeSignalCheck,
  MergeSort,
  MergeTab
} from '~/types/api/officialMirror'

export const TAB_LABEL: Record<MergeTab, string> = {
  pending: '待处理',
  dismissed: '已驳回',
  merged: '已合并'
}

export const PAIR_CLASS_LABEL = {
  high: '高置信',
  manual: '需人工核对'
} as const

export const SORT_LABEL: Record<MergeSort, string> = {
  download_desc: '获取次数从高到低',
  waiting_longest: '等待最久',
  game_name: '按游戏名称',
  handled_desc: '最近处理'
}

const PENDING_SORTS: readonly MergeSort[] = [
  'download_desc',
  'waiting_longest',
  'game_name'
]
const HISTORY_SORTS: readonly MergeSort[] = [
  'handled_desc',
  'waiting_longest',
  'game_name',
  'download_desc'
]

/** Sort choices of a tab; the first one is the server default. */
export const sortsForTab = (tab: MergeTab) =>
  tab === 'pending' ? PENDING_SORTS : HISTORY_SORTS

/** History rows read `waiting_longest` as the earliest record. */
export const sortLabel = (tab: MergeTab, sort: MergeSort) =>
  tab !== 'pending' && sort === 'waiting_longest'
    ? '最早处理'
    : SORT_LABEL[sort]

export const sectionLabel = (section: string) =>
  RESOURCE_SECTION_MAP[section] ?? section

export const cardName = (name: string | null | undefined) =>
  name && name.trim() ? name : '未命名资源'

export const showTime = (value: string | null | undefined) => {
  if (!value) return '—'
  const time = Date.parse(value)
  return Number.isNaN(time) ? '—' : formatChinaDateTime(time)
}

export type RowBadge = {
  text: string
  tone: 'recommended' | 'high' | 'manual' | 'none'
}

/** The one badge a pending row shows. */
export const rowBadge = (row: MergeListItem): RowBadge => {
  if (row.recommendState === 'none') return { text: '无可合并项', tone: 'none' }
  if (row.pairClass === 'high') return { text: '高置信', tone: 'high' }
  if (row.recommendState === 'recommended' && row.recommendation) {
    return {
      text: `推荐 #${row.recommendation.staffResourceId}`,
      tone: 'recommended'
    }
  }
  return { text: '需人工核对', tone: 'manual' }
}

export const rowMeta = (row: MergeListItem) =>
  [
    row.userResource.patchName || '—',
    sectionLabel(row.userResource.section),
    row.userResource.publisher?.name || '—',
    `官方 ${typeof row.officialCount === 'number' ? row.officialCount : '—'}`
  ].join(' · ')

export const SIGNAL_LABEL: Record<MergeSignal, string> = {
  type: '类型',
  language: '语言',
  platform: '平台',
  size: '大小',
  name: '名称',
  later: '站方发布较晚',
  unique: '互为唯一'
}

const joinValues = (
  values: readonly string[],
  labels?: Record<string, string>
) =>
  values.length
    ? values.map((value) => labels?.[value] ?? value).join('、')
    : '—'

const signalSide = (signal: MergeSignal, values: readonly string[]) => {
  if (signal === 'type') return joinValues(values, SUPPORTED_TYPE_MAP)
  if (signal === 'language') return joinValues(values, SUPPORTED_LANGUAGE_MAP)
  if (signal === 'platform') return joinValues(values, SUPPORTED_PLATFORM_MAP)
  if (signal === 'later') {
    return values.length
      ? values.map((value) => showTime(value)).join('、')
      : '—'
  }
  if (signal === 'unique') {
    return values.length ? `${values.join('、')} 个配对` : '—'
  }
  return joinValues(values)
}

/** `✓ 类型` for a hit, `✗ 类型：PC游戏 / 追加内容` (user / staff) for a miss. */
export const signalText = (check: MergeSignalCheck) => {
  const label = SIGNAL_LABEL[check.signal] ?? check.signal
  if (check.hit) return `✓ ${label}`
  return `✗ ${label}：${signalSide(check.signal, check.user)} / ${signalSide(check.signal, check.staff)}`
}

export type OptionGroups = {
  recommended: MergeOption[]
  mergeable: MergeOption[]
  blocked: MergeOption[]
}

/** Keeps the server order inside each group. */
export const groupOptions = (options: readonly MergeOption[]): OptionGroups => {
  const groups: OptionGroups = { recommended: [], mergeable: [], blocked: [] }
  for (const option of options) {
    if (option.mergeable && option.recommended) groups.recommended.push(option)
    else if (option.mergeable) groups.mergeable.push(option)
    else groups.blocked.push(option)
  }
  return groups
}

/**
 * The pair the workbench opens with: the recommended option, else the first
 * mergeable one, else the first option. The dismissed tab opens a dismissed
 * pair first, since that is why the row is listed there.
 */
export const defaultStaffId = (
  options: readonly MergeOption[],
  tab: MergeTab
): number | null => {
  if (tab === 'dismissed') {
    const dismissed = options.find((option) => option.record === 'dismissed')
    if (dismissed) return dismissed.staff.id
  }
  const pick =
    options.find((option) => option.mergeable && option.recommended) ??
    options.find((option) => option.mergeable) ??
    options[0]
  return pick ? pick.staff.id : null
}

/** Why an option cannot be merged, as shown under the 不可合并 group. */
export const blockedReasons = (option: MergeOption): string[] => {
  const reasons = option.blocks.map((block) => block.message).filter(Boolean)
  if (option.record === 'dismissed' && reasons.length === 0) {
    reasons.push('这一对已驳回')
  }
  if (!option.sameSection && reasons.length === 0) {
    reasons.push('与用户资源不在同一分区，不能合并')
  }
  if (reasons.length === 0) reasons.push('当前不能合并')
  return [...new Set(reasons)]
}

export const dismissableIds = (options: readonly MergeOption[]) =>
  options
    .filter((option) => option.dismissable)
    .map((option) => option.staff.id)

/** Dialog copy. Each text states the consequence only. */
export const mergeConsequence = (preview: MergePreview) => {
  const u = preview.user.id
  const s = preview.staff.id
  return {
    consequence: `#${s} ${cardName(preview.staff.name)} 并入 #${u} ${cardName(preview.user.name)}，#${s} 随后删除。#${u} 保留名称、属性和发布者，仍在社区资源分组。`,
    lines: preview.exitedPairs.map(
      (pair) =>
        `#${pair.staffResourceId} 与 #${u} 的配对退出，#${pair.staffResourceId} 保留。`
    )
  }
}

export const dismissConsequence = (u: number, s: number) =>
  `#${u} 与 #${s} 的配对移入已驳回。`

export const dismissCardConsequence = (u: number, count: number) =>
  `#${u} 当前的 ${count} 个配对全部移入已驳回。`

export const reopenConsequence = (u: number, s: number) =>
  `#${u} 与 #${s} 的配对回到待处理。`

export const batchRunConsequence = (count: number) =>
  `清单中的 ${count} 对逐对合并，各对的站方卡片随后删除。`

export const userCardSrc = (id: number) => `/preview/resource-card/${id}`
export const survivorSrc = (user: number, staff: number) =>
  `/preview/resource-merge?${new URLSearchParams({
    user: String(user),
    staff: String(staff)
  }).toString()}`

const UNIQUE_ID = /^[A-Za-z0-9]{8}$/

/** The card on its public game page, or null without a valid page id. */
export const cardPageHref = (card: {
  patchUniqueId: string
  section: string
  id: number
}) => {
  if (!UNIQUE_ID.test(card.patchUniqueId)) return null
  const params = new URLSearchParams({
    tab: 'resources',
    resourceSection: card.section,
    resourceId: String(card.id)
  })
  return `/${card.patchUniqueId}?${params.toString()}`
}

export const linkStorageLabel = (storage: string) =>
  SUPPORTED_RESOURCE_LINK_MAP[storage] ?? storage

const linkCount = (preview: MergePreview, side: 'user' | 'staff') => {
  const row = preview.fieldComparison.find((field) => field.field === '链接数')
  const value = row ? Number(row[side]) : Number.NaN
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

/** Facts of 合并此配对的结果, all read from the preview. */
export const mergeOutcome = (preview: MergePreview) => {
  const u = preview.user.id
  const s = preview.staff.id
  const links = [...preview.survivorPreview.links].sort(
    (left, right) => left.sortOrder - right.sortOrder || left.id - right.id
  )
  const backupCount = links.filter((link) => link.storage === 'touchgal').length
  const userLinks = linkCount(preview, 'user')
  const staffLinks = linkCount(preview, 'staff')
  const composition =
    userLinks !== null &&
    staffLinks !== null &&
    userLinks + staffLinks === links.length
      ? `合并后共 ${links.length} 条链接：原有 ${userLinks} 条在前，移入 ${staffLinks} 条在后。`
      : `合并后共 ${links.length} 条链接。`
  const userDownload = preview.user.download
  const staffDownload = preview.staff.download
  const likes =
    typeof preview.staffLikeCount === 'number' ? preview.staffLikeCount : null
  return {
    deletion: `#${s} ${cardName(preview.staff.name)} 删除，指向 #${s} 的旧链接改为定位到 #${u}。`,
    kept: `#${u} 保留名称、类型、语言、平台和发布者，仍在社区资源分组。`,
    attributes: [
      `名称：${cardName(preview.survivorPreview.name)}`,
      `类型：${joinValues(preview.survivorPreview.type, SUPPORTED_TYPE_MAP)}`,
      `语言：${joinValues(preview.survivorPreview.language, SUPPORTED_LANGUAGE_MAP)}`,
      `平台：${joinValues(preview.survivorPreview.platform, SUPPORTED_PLATFORM_MAP)}`
    ],
    composition,
    links,
    note: preview.survivorPreview.noteAppended
      ? '站方备注以「站方备份说明」追加在备注末尾。'
      : '备注保持用户资源原文。',
    download: `获取次数合计 ${userDownload + staffDownload}（${userDownload} + ${staffDownload}）。`,
    likes:
      likes === null
        ? null
        : likes > 0
          ? `#${s} 的 ${likes} 个点赞不迁移。`
          : `#${s} 没有点赞。`,
    exited: preview.exitedPairs.map(
      (pair) =>
        `#${pair.staffResourceId} ${cardName(pair.staffName)} 与 #${u} 的配对退出，#${pair.staffResourceId} 保留。`
    ),
    backupWarning:
      backupCount >= 2 ? `合并后有 ${backupCount} 条站方备份链接。` : null
  }
}
