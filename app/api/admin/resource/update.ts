import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { updatePatchResource as updatePatchResourceByRole } from '~/app/api/patch/resource/update'
import { sanitizeResourceForAuditLog } from '~/app/api/patch/resource/_helper'
import { patchResourceUpdateSchema } from '~/validations/patch'
import { createMessage } from '~/app/api/utils/message'
import {
  RESOURCE_SECTION_MAP,
  SUPPORTED_LANGUAGE_MAP,
  SUPPORTED_PLATFORM_MAP,
  SUPPORTED_TYPE_MAP,
  storageTypes
} from '~/constants/resource'
import type { PatchResource } from '~/types/api/patch'
import type { AdminResource } from '~/types/api/admin'

type ResourceChangeSource = {
  name: string
  section: string
  type: string[]
  language: string[]
  platform: string[]
  note: string
  links: ResourceChangeSourceLink[]
}

type ResourceChangeSourceLink = {
  id?: number | null
  storage: string
  content?: string | null
  code?: string | null
  password?: string | null
  hash?: string | null
  size?: string | null
  sort_order?: number | null
  sortOrder?: number | null
}

type NormalizedResourceLink = {
  id: number | null
  storage: string
  content: string
  code: string
  password: string
  hash: string
  size: string
  sortOrder: number
  position: number
}

const formatValue = (value: string) => (value.trim() ? value : '未填写')

const formatList = (values: string[], labels: Record<string, string>) => {
  return values.length
    ? values.map((value) => labels[value] ?? value).join('、')
    : '未填写'
}

const RESOURCE_LINK_STORAGE_MAP = Object.fromEntries(
  storageTypes.map((type) => [type.value, type.label])
)

const getLinkStorageLabel = (storage: string) => {
  return RESOURCE_LINK_STORAGE_MAP[storage] ?? (storage || '未知类型')
}

const formatResourceLinksSummary = (links: { storage: string }[]) => {
  if (!links.length) {
    return '0 个链接'
  }

  const storageCounts = links.reduce<Record<string, number>>((acc, link) => {
    const label = getLinkStorageLabel(link.storage)
    acc[label] = (acc[label] ?? 0) + 1
    return acc
  }, {})
  const storageSummary = Object.entries(storageCounts)
    .map(([label, count]) => `${label} ${count} 个`)
    .join('、')

  return `${links.length} 个链接（${storageSummary}）`
}

const normalizeResourceLinks = (
  links: ResourceChangeSourceLink[]
): NormalizedResourceLink[] => {
  const sortedLinks = links
    .map((link, index) => ({
      id: link.id ?? null,
      storage: link.storage,
      content: link.content ?? '',
      code: link.code ?? '',
      password: link.password ?? '',
      hash: link.hash ?? '',
      size: link.size ?? '',
      sortOrder: link.sort_order ?? link.sortOrder ?? index
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || (a.id ?? 0) - (b.id ?? 0))

  return sortedLinks.map((link, position) => ({ ...link, position }))
}

const hasFilledValue = (value: string) => !!value.trim()

const formatFilledState = (value: string) => {
  return hasFilledValue(value) ? '已填写' : '未填写'
}

const formatSensitiveFieldChange = (
  label: string,
  before: string,
  after: string,
  updatedText = `${label}已更新`
) => {
  const beforeFilled = hasFilledValue(before)
  const afterFilled = hasFilledValue(after)

  if (beforeFilled !== afterFilled) {
    return `${label}: ${formatFilledState(before)} -> ${formatFilledState(after)}`
  }

  return updatedText
}

const formatResourceLinkState = (link: NormalizedResourceLink) => {
  return [
    `存储类型: ${getLinkStorageLabel(link.storage)}`,
    `大小 (MB 或 GB): ${formatValue(link.size)}`,
    `资源链接: ${formatFilledState(link.content)}`,
    `提取码: ${formatFilledState(link.code)}`,
    `解压码: ${formatFilledState(link.password)}`,
    `Hash: ${formatFilledState(link.hash)}`
  ].join('、')
}

const scoreResourceLinkMatch = (
  before: NormalizedResourceLink,
  after: NormalizedResourceLink
) => {
  let score = 0

  if (before.storage === after.storage) {
    score += 8
  }
  if (before.content && before.content === after.content) {
    score += 8
  }
  if (before.hash && before.hash === after.hash) {
    score += 5
  }
  if (before.size && before.size === after.size) {
    score += 3
  }
  if (before.code && before.code === after.code) {
    score += 3
  }
  if (before.password && before.password === after.password) {
    score += 3
  }
  if (before.position === after.position) {
    score += 2
  }

  return score
}

const pairResourceLinks = (
  beforeLinks: NormalizedResourceLink[],
  afterLinks: NormalizedResourceLink[]
) => {
  const beforeMatched = new Set<number>()
  const afterMatched = new Set<number>()
  const pairs: {
    before: NormalizedResourceLink
    after: NormalizedResourceLink
  }[] = []

  afterLinks.forEach((after, afterIndex) => {
    if (after.id === null) {
      return
    }

    const beforeIndex = beforeLinks.findIndex(
      (before, index) =>
        !beforeMatched.has(index) &&
        before.id !== null &&
        before.id === after.id
    )
    if (beforeIndex === -1) {
      return
    }

    beforeMatched.add(beforeIndex)
    afterMatched.add(afterIndex)
    pairs.push({ before: beforeLinks[beforeIndex], after })
  })

  afterLinks.forEach((after, afterIndex) => {
    if (afterMatched.has(afterIndex)) {
      return
    }

    let bestBeforeIndex = -1
    let bestScore = 0
    beforeLinks.forEach((before, beforeIndex) => {
      if (beforeMatched.has(beforeIndex)) {
        return
      }

      const score = scoreResourceLinkMatch(before, after)
      if (score > bestScore) {
        bestScore = score
        bestBeforeIndex = beforeIndex
      }
    })

    if (bestBeforeIndex === -1 || bestScore < 4) {
      return
    }

    beforeMatched.add(bestBeforeIndex)
    afterMatched.add(afterIndex)
    pairs.push({ before: beforeLinks[bestBeforeIndex], after })
  })

  return {
    pairs: pairs.sort((a, b) => a.after.position - b.after.position),
    removed: beforeLinks.filter((_, index) => !beforeMatched.has(index)),
    added: afterLinks.filter((_, index) => !afterMatched.has(index))
  }
}

const getResourceLinkFieldChanges = (
  before: NormalizedResourceLink,
  after: NormalizedResourceLink
) => {
  const changes: string[] = []

  if (before.storage !== after.storage) {
    changes.push(
      `存储类型: ${getLinkStorageLabel(before.storage)} -> ${getLinkStorageLabel(after.storage)}`
    )
  }
  if (before.content !== after.content) {
    changes.push(
      formatSensitiveFieldChange(
        '资源链接',
        before.content,
        after.content,
        '资源链接已更新'
      )
    )
  }
  if (before.size !== after.size) {
    changes.push(
      `大小 (MB 或 GB): ${formatValue(before.size)} -> ${formatValue(after.size)}`
    )
  }
  if (before.code !== after.code) {
    changes.push(formatSensitiveFieldChange('提取码', before.code, after.code))
  }
  if (before.password !== after.password) {
    changes.push(
      formatSensitiveFieldChange('解压码', before.password, after.password)
    )
  }
  if (before.hash !== after.hash) {
    changes.push(
      formatSensitiveFieldChange('Hash', before.hash, after.hash, 'Hash 已更新')
    )
  }

  return changes
}

const buildResourceLinkChangeSummary = (
  before: ResourceChangeSource['links'],
  after: PatchResource['links']
) => {
  const changes: string[] = []
  const beforeLinksSummary = formatResourceLinksSummary(before)
  const afterLinksSummary = formatResourceLinksSummary(after)

  if (beforeLinksSummary !== afterLinksSummary) {
    changes.push(`- 资源链接: ${beforeLinksSummary} -> ${afterLinksSummary}`)
  }

  const beforeLinks = normalizeResourceLinks(before)
  const afterLinks = normalizeResourceLinks(after)
  const { pairs, removed, added } = pairResourceLinks(beforeLinks, afterLinks)

  pairs.forEach(({ before, after }) => {
    const fieldChanges = getResourceLinkFieldChanges(before, after)
    if (fieldChanges.length) {
      changes.push(
        `- 资源链接 #${after.position + 1}: ${fieldChanges.join('、')}`
      )
    }
  })

  removed.forEach((link) => {
    changes.push(
      `- 原资源链接 #${link.position + 1}: 删除（${formatResourceLinkState(link)}）`
    )
  })

  added.forEach((link) => {
    changes.push(
      `- 资源链接 #${link.position + 1}: 新增（${formatResourceLinkState(link)}）`
    )
  })

  return changes
}

const pushFieldChange = (
  changes: string[],
  label: string,
  before: string,
  after: string
) => {
  if (before !== after) {
    changes.push(`- ${label}: ${before} -> ${after}`)
  }
}

const buildResourceChangeSummary = (
  before: ResourceChangeSource,
  after: PatchResource
) => {
  const changes: string[] = []

  pushFieldChange(
    changes,
    '资源名称',
    formatValue(before.name),
    formatValue(after.name)
  )
  pushFieldChange(
    changes,
    '资源类别',
    RESOURCE_SECTION_MAP[before.section] ?? before.section,
    RESOURCE_SECTION_MAP[after.section] ?? after.section
  )
  pushFieldChange(
    changes,
    '类型',
    formatList(before.type, SUPPORTED_TYPE_MAP),
    formatList(after.type, SUPPORTED_TYPE_MAP)
  )
  pushFieldChange(
    changes,
    '语言',
    formatList(before.language, SUPPORTED_LANGUAGE_MAP),
    formatList(after.language, SUPPORTED_LANGUAGE_MAP)
  )
  pushFieldChange(
    changes,
    '平台',
    formatList(before.platform, SUPPORTED_PLATFORM_MAP),
    formatList(after.platform, SUPPORTED_PLATFORM_MAP)
  )
  pushFieldChange(
    changes,
    '备注',
    formatValue(before.note),
    formatValue(after.note)
  )
  changes.push(...buildResourceLinkChangeSummary(before.links, after.links))

  return changes.join('\n')
}

export const updatePatchResource = async (
  input: z.infer<typeof patchResourceUpdateSchema>,
  uid: number
) => {
  const admin = await prisma.user.findUnique({ where: { id: uid } })
  if (!admin) {
    return '未找到该管理员'
  }

  const { resourceId } = input
  const resource = await prisma.patch_resource.findUnique({
    where: { id: resourceId },
    include: {
      patch: {
        select: {
          name: true
        }
      },
      links: {
        orderBy: { sort_order: 'asc' }
      }
    }
  })
  if (!resource) {
    return '未找到该资源'
  }

  const updatedResource = await updatePatchResourceByRole(input, uid, 3)
  if (typeof updatedResource === 'string') {
    return updatedResource
  }
  const updatedAdminResource: AdminResource = {
    ...updatedResource,
    patchName: resource.patch.name
  }

  const sanitizedResource = sanitizeResourceForAuditLog(resource)
  const sanitizedUpdatedResource =
    sanitizeResourceForAuditLog(updatedAdminResource)
  const resourceTypeName =
    updatedAdminResource.section === 'galgame' ? '游戏资源' : '补丁资源'

  return await prisma.$transaction(async (prisma) => {
    if (resource.user_id !== uid) {
      const changeSummary = buildResourceChangeSummary(
        resource,
        updatedAdminResource
      )
      await createMessage(
        {
          type: 'system',
          content: `管理员修改了你发布的${resourceTypeName}「${updatedAdminResource.name}」。${
            changeSummary ? `\n\n修改内容:\n${changeSummary}` : ''
          }`,
          sender_id: uid,
          recipient_id: resource.user_id,
          link: updatedAdminResource.uniqueId
            ? `/${updatedAdminResource.uniqueId}`
            : '/'
        },
        prisma
      )
    }

    await prisma.admin_log.create({
      data: {
        type: 'update',
        user_id: uid,
        content: `管理员 ${admin.name} 更新了一个${resourceTypeName}信息\n\n原${resourceTypeName}信息:\n${JSON.stringify(sanitizedResource)}\n\n新${resourceTypeName}信息:\n${JSON.stringify(sanitizedUpdatedResource)}`
      }
    })

    return updatedAdminResource
  })
}
