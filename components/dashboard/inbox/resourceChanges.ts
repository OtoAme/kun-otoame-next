import {
  RESOURCE_SECTION_MAP,
  SUPPORTED_LANGUAGE_MAP,
  SUPPORTED_PLATFORM_MAP,
  SUPPORTED_RESOURCE_LINK_MAP,
  SUPPORTED_TYPE_MAP
} from '~/constants/resource'
import type { AdminResource } from '~/types/api/admin'

export interface ResourceChange {
  label: string
  before: string
  after: string
}

const list = (values: string[], labels: Record<string, string>) =>
  values.map((value) => labels[value] ?? value).join('、') || '无'

const text = (value: string | undefined) => value?.trim() || '空'

type Link = AdminResource['links'][number]

const linkFields: { key: keyof Link; label: string }[] = [
  { key: 'storage', label: '存储' },
  { key: 'content', label: '地址' },
  { key: 'size', label: '大小' },
  { key: 'code', label: '提取码' },
  { key: 'password', label: '解压码' }
]

const linkValue = (link: Link, key: keyof Link) =>
  key === 'storage'
    ? (SUPPORTED_RESOURCE_LINK_MAP[link.storage] ?? link.storage)
    : text(link[key] as string | undefined)

/**
 * Field-level differences between two snapshots of the same resource, in
 * display text. Links match by ID; links without a match count as added or
 * removed.
 */
export function resourceChanges(
  before: AdminResource,
  after: AdminResource
): ResourceChange[] {
  const changes: ResourceChange[] = []
  const push = (label: string, from: string, to: string) => {
    if (from !== to) changes.push({ label, before: from, after: to })
  }
  push('名称', text(before.name), text(after.name))
  push(
    '分区',
    RESOURCE_SECTION_MAP[before.section] ?? before.section,
    RESOURCE_SECTION_MAP[after.section] ?? after.section
  )
  push(
    '类型',
    list(before.type, SUPPORTED_TYPE_MAP),
    list(after.type, SUPPORTED_TYPE_MAP)
  )
  push(
    '语言',
    list(before.language, SUPPORTED_LANGUAGE_MAP),
    list(after.language, SUPPORTED_LANGUAGE_MAP)
  )
  push(
    '平台',
    list(before.platform, SUPPORTED_PLATFORM_MAP),
    list(after.platform, SUPPORTED_PLATFORM_MAP)
  )
  push('备注', text(before.note), text(after.note))

  after.links.forEach((link, index) => {
    const old = before.links.find((item) => item.id === link.id)
    const label = `链接 #${index + 1}`
    if (!old) {
      push(label, '无', `新增（${linkValue(link, 'storage')}）`)
      return
    }
    for (const field of linkFields) {
      push(
        `${label} ${field.label}`,
        linkValue(old, field.key),
        linkValue(link, field.key)
      )
    }
  })
  before.links.forEach((link) => {
    if (!after.links.some((item) => item.id === link.id)) {
      push(
        '链接',
        `${linkValue(link, 'storage')}：${text(link.content)}`,
        '已移除'
      )
    }
  })
  return changes
}
