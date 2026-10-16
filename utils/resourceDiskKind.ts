import type { LinkCheckProvider } from '~/types/api/linkHealth'
import { parseResourceLink } from '~/utils/resourceLink'
import { recognizeLinkCheckProviderFromUrl } from '~/utils/recognizeLinkCheckProvider'

/** 卡片标签。网盘和 OtoAme 资源盘按地址域名识别，对象存储按 storage。 */
export type ResourceDiskKind = LinkCheckProvider | 'otoame' | 'object' | 'other'

export const RESOURCE_DISK_KIND_LABELS: Record<ResourceDiskKind, string> = {
  baidu: '百度网盘',
  quark: '夸克网盘',
  uc: 'UC网盘',
  caiyun: '和彩云',
  pan123: '123云盘',
  otoame: 'OtoAme 资源盘',
  object: '对象存储',
  other: '其他'
}

const OTOAME_DISK_HOST = 'pan.otoame.top'

const urlFromContent = (content: string) => {
  const parsed = parseResourceLink(content).url
  if (!parsed) {
    return null
  }
  try {
    return new URL(parsed)
  } catch {
    return null
  }
}

const isOtoameDiskHost = (url: URL) =>
  url.protocol === 'https:' &&
  !url.username &&
  !url.password &&
  !url.port &&
  url.hostname === OTOAME_DISK_HOST

/**
 * 有地址时先认域名：五个网盘沿用检测规则，主机名恰好是 pan.otoame.top
 * 时为 OtoAme 资源盘。对象存储不看域名。没有可识别地址时，s3 仍是对象存储，
 * 其余归为其他。
 */
export const recognizeResourceDiskKind = (
  content: string | null | undefined,
  storage: string
): ResourceDiskKind => {
  const url = content ? urlFromContent(content) : null
  if (url) {
    const netdisk = recognizeLinkCheckProviderFromUrl(url)
    if (netdisk) {
      return netdisk
    }
    if (isOtoameDiskHost(url)) {
      return 'otoame'
    }
  }
  if (storage === 's3') {
    return 'object'
  }
  return 'other'
}

export const resolveDisplayedDiskKind = (input: {
  storage: string
  content?: string | null
  diskKind?: ResourceDiskKind | null
  healthProvider?: LinkCheckProvider | null
}): ResourceDiskKind => {
  if (input.content) {
    return recognizeResourceDiskKind(input.content, input.storage)
  }
  if (input.diskKind) {
    return input.diskKind
  }
  if (input.healthProvider) {
    return input.healthProvider
  }
  return recognizeResourceDiskKind(null, input.storage)
}
