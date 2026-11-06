import { formatChinaDateTime } from '~/utils/fixedTimezoneDate'

export type PublicMirrorFacts = {
  staffMaintained: boolean
  hasStaffBackup: boolean
  publisherLeftAt: string | null
  backupDates: string[]
}

const EMPTY: PublicMirrorFacts = {
  staffMaintained: false,
  hasStaffBackup: false,
  publisherLeftAt: null,
  backupDates: []
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export const formatBackupDate = (value: string): string | null => {
  const time = Date.parse(value)
  if (Number.isNaN(time)) return null
  return `${formatChinaDateTime(time).replaceAll('/', '-')} UTC+08:00`
}

/** 公开卡片上的备份与维护事实。分组不读这些字段。 */
export const readPublicMirrorFacts = (value: unknown): PublicMirrorFacts => {
  if (!isRecord(value)) return EMPTY
  const leftRaw = Object.prototype.hasOwnProperty.call(value, 'publisherLeftAt')
    ? value.publisherLeftAt
    : null
  const publisherLeftAt = typeof leftRaw === 'string' ? leftRaw : null
  const links = Array.isArray(value.links) ? value.links : []
  const backupDates: string[] = []
  const pushDate = (raw: unknown) => {
    if (typeof raw !== 'string') return
    const formatted = formatBackupDate(raw)
    if (formatted) backupDates.push(formatted)
  }
  pushDate(value.backedUpAt)
  for (const link of links) {
    if (!isRecord(link)) continue
    pushDate(link.backedUpAt)
  }
  return {
    staffMaintained: typeof leftRaw === 'string',
    hasStaffBackup: value.hasStaffBackup === true,
    publisherLeftAt,
    backupDates
  }
}

/** 控制台链接详情里的辅助点击。缺字段不是 0。 */
export const readAuxiliaryClick = (link: unknown): number | null => {
  if (!isRecord(link) || typeof link.click !== 'number') return null
  if (!Number.isFinite(link.click)) return null
  return link.click
}
