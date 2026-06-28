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

type ResourceChangeSource = {
  name: string
  section: string
  type: string[]
  language: string[]
  platform: string[]
  note: string
  links: { storage: string }[]
}

const formatValue = (value: string) => (value.trim() ? value : '未填写')

const formatList = (
  values: string[],
  labels: Record<string, string>
) => {
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

const normalizeResourceLinksForCompare = (
  links: {
    id?: number
    storage: string
    content?: string
    code?: string
    password?: string
    hash?: string
    size?: string
    sort_order?: number
    sortOrder?: number
    download?: number
  }[]
) => {
  return links
    .map((link, index) => ({
      id: link.id ?? null,
      storage: link.storage,
      content: link.content ?? '',
      code: link.code ?? '',
      password: link.password ?? '',
      hash: link.hash ?? '',
      size: link.size ?? '',
      sortOrder: link.sort_order ?? link.sortOrder ?? index,
      download: link.download ?? 0
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || (a.id ?? 0) - (b.id ?? 0))
}

const hasResourceLinkChanged = (
  before: ResourceChangeSource['links'],
  after: PatchResource['links']
) => {
  return (
    JSON.stringify(normalizeResourceLinksForCompare(before)) !==
    JSON.stringify(normalizeResourceLinksForCompare(after))
  )
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
  const beforeLinksSummary = formatResourceLinksSummary(before.links)
  const afterLinksSummary = formatResourceLinksSummary(after.links)
  if (beforeLinksSummary !== afterLinksSummary) {
    changes.push(`- 资源链接: ${beforeLinksSummary} -> ${afterLinksSummary}`)
  } else if (hasResourceLinkChanged(before.links, after.links)) {
    changes.push(`- 资源链接: 已更新（当前 ${afterLinksSummary}）`)
  }

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

  const sanitizedResource = sanitizeResourceForAuditLog(resource)
  const sanitizedUpdatedResource = sanitizeResourceForAuditLog(updatedResource)

  return await prisma.$transaction(async (prisma) => {
    if (resource.user_id !== uid) {
      const resourceTypeName =
        updatedResource.section === 'galgame' ? '游戏资源' : '补丁资源'
      const changeSummary = buildResourceChangeSummary(
        resource,
        updatedResource
      )
      await createMessage(
        {
          type: 'system',
          content: `管理员修改了你发布的${resourceTypeName}「${updatedResource.name}」。${
            changeSummary ? `\n\n修改内容:\n${changeSummary}` : ''
          }`,
          sender_id: uid,
          recipient_id: resource.user_id,
          link: updatedResource.uniqueId ? `/${updatedResource.uniqueId}` : '/'
        },
        prisma
      )
    }

    await prisma.admin_log.create({
      data: {
        type: 'update',
        user_id: uid,
        content: `管理员 ${admin.name} 更新了一个补丁资源信息\n\n原补丁资源信息:\n${JSON.stringify(sanitizedResource)}\n\n新补丁资源信息:\n${JSON.stringify(sanitizedUpdatedResource)}`
      }
    })

    return updatedResource
  })
}
