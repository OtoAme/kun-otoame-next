export const resourceTypes = [
  {
    value: 'pc',
    label: 'PC游戏',
    description: '在 Windows, macOS 等电脑设备上运行的游戏'
  },
  {
    value: 'emulator',
    label: '主机游戏',
    description:
      '在主机平台游玩的游戏, 或由模拟器支持的主机平台资源'
  },
  {
    value: 'mobile',
    label: '手机游戏',
    description: '可以在手机上运行的游戏，包含原先的安卓直装资源'
  },
  {
    value: 'row',
    label: '生肉',
    description: '没有中文翻译, 仅有日语或其它语言的游戏'
  },
  {
    value: 'chinese',
    label: '民汉',
    description: '汉化版游戏或补丁, 有简体中文或繁体中文支持'
  },
  {
    value: 'official-zh',
    label: '官中',
    description: '官方发行的中文版游戏'
  },
  {
    value: 'machine',
    label: '机翻',
    description: '机器翻译版本的游戏或补丁, 可能质量较低但能提供基本的中文支持'
  },
  {
    value: 'material',
    label: '资料集',
    description: '与游戏相关的资料，包括设定内容、视觉作品及各类特典'
  },
  {
    value: 'tool',
    label: '工具',
    description: '辅助游玩 OtomeGame 的工具, 例如 KRKR 模拟器, Magpie 等'
  },
  {
    value: 'patch',
    label: '补丁',
    description: '与本游戏相关的补丁资源'
  },
  {
    value: 'strategy',
    label: '攻略',
    description: '与本游戏相关的攻略内容'
  },
  {
    value: 'save',
    label: '存档',
    description: '与本游戏相关的存档资源'
  },
  {
    value: 'other',
    label: '其它',
    description: '其它内容'
  }
]

export const SUPPORTED_TYPE = [
  'pc',
  'emulator',
  'mobile',
  'chinese',
  'official-zh',
  'row',
  'machine',
  'material',
  'strategy',
  'patch',
  'tool',
  'save',
  'other'
]

export type ResourceSection = 'galgame' | 'patch'

export const GALGAME_RESOURCE_TYPES = [
  'pc',
  'emulator',
  'mobile',
  'material',
  'tool',
  'chinese',
  'official-zh',
  'row',
  'machine'
] as const

export const PATCH_RESOURCE_TYPES = ['patch', 'tool', 'strategy', 'save'] as const

export const RESOURCE_TYPES_BY_SECTION: Record<ResourceSection, readonly string[]> =
{
  galgame: GALGAME_RESOURCE_TYPES,
  patch: PATCH_RESOURCE_TYPES
}

export const getResourceTypeOptionsBySection = (
  section: ResourceSection
) => {
  const allowed = new Set(RESOURCE_TYPES_BY_SECTION[section])
  return resourceTypes.filter((item) => allowed.has(item.value))
}

export const isResourceTypeAllowedForSection = (
  section: ResourceSection,
  type: string
) => {
  return RESOURCE_TYPES_BY_SECTION[section].includes(type)
}

export const normalizeLegacyResourceTypes = (types: string[]): string[] => {
  return Array.from(new Set(types))
}

export const normalizeTypesBySection = (
  section: ResourceSection,
  types: string[]
): string[] => {
  const normalized = normalizeLegacyResourceTypes(types)
  return normalized.filter((type) => isResourceTypeAllowedForSection(section, type))
}
export const SUPPORTED_TYPE_MAP: Record<string, string> = {
  all: '全部类型',
  pc: 'PC游戏',
  emulator: '主机游戏',
  mobile: '手机游戏',
  chinese: '民汉',
  'official-zh': '官中',
  row: '生肉',
  machine: '机翻',
  material: '资料集',
  strategy: '攻略',
  patch: '补丁',
  tool: '工具',
  save: '存档',
  other: '其它'
}
export const ALL_SUPPORTED_TYPE = ['all', ...SUPPORTED_TYPE]

export const SUPPORTED_LANGUAGE = ['zh-Hans', 'zh-Hant', 'ja', 'en', 'other']
export const ALL_SUPPORTED_LANGUAGE = ['all', ...SUPPORTED_LANGUAGE]
export const SUPPORTED_LANGUAGE_MAP: Record<string, string> = {
  all: '全部语言',
  'zh-Hans': '简体中文',
  'zh-Hant': '繁體中文',
  ja: '日本語',
  en: 'English',
  other: '其它'
}

export const SUPPORTED_PLATFORM = [
  'windows',
  'android',
  'macos',
  'psp',
  'ns',
  'psv',
  'ps2',
  'ios',
  'linux',
  'ons',
  'krkr',
  'tyranor',
  'other'
]
export const ALL_SUPPORTED_PLATFORM = ['all', ...SUPPORTED_PLATFORM]
export const SUPPORTED_PLATFORM_MAP: Record<string, string> = {
  all: '全部平台',
  windows: 'Windows',
  android: 'Android',
  macos: 'MacOS',
  psp: 'PSP',
  ns: 'NS',
  psv: 'PSV',
  ps2: 'PS2',
  ios: 'iOS',
  linux: 'Linux',
  ons: 'ONS',
  krkr: 'KRKR',
  tyranor: 'Tyranor',
  other: '其它'
}

const GALGAME_PC_PLATFORMS = ['windows', 'macos', 'linux', 'other']
const GALGAME_MOBILE_PLATFORMS = [
  'android',
  'ios',
  'krkr',
  'tyranor',
  'ons',
  'other'
]
const GALGAME_CONSOLE_PLATFORMS = ['psp', 'psv', 'ps2', 'ns', 'other']
const GALGAME_MATERIAL_PLATFORMS = ['other']

export const getAllowedPlatformsBySectionAndTypes = (
  section: ResourceSection,
  types: string[]
): string[] => {
  // 补丁分区维持全平台可选，避免误限制历史内容发布。
  if (section === 'patch') {
    return SUPPORTED_PLATFORM
  }

  if (!types.length) {
    return ['other']
  }

  if (types.includes('tool')) {
    return SUPPORTED_PLATFORM
  }

  const allowed = new Set<string>()

  if (types.includes('pc')) {
    GALGAME_PC_PLATFORMS.forEach((platform) => allowed.add(platform))
  }
  if (types.includes('mobile')) {
    GALGAME_MOBILE_PLATFORMS.forEach((platform) => allowed.add(platform))
  }
  if (types.includes('emulator')) {
    GALGAME_CONSOLE_PLATFORMS.forEach((platform) => allowed.add(platform))
  }
  if (types.includes('material')) {
    GALGAME_MATERIAL_PLATFORMS.forEach((platform) => allowed.add(platform))
  }

  if (!allowed.size) {
    return ['other']
  }

  return SUPPORTED_PLATFORM.filter((platform) => allowed.has(platform))
}

export const SUPPORTED_RESOURCE_LINK = ['touchgal', 's3', 'user']

export const storageTypes = [
  {
    value: 'touchgal',
    label: 'OtoAme 资源盘 (官方可用)',
    description: '此选项用于官方发布 OtomeGame 下载资源'
  },
  {
    value: 's3',
    label: '对象存储 (<100MB, 创作者可用)',
    description: '此选项适合 <100MB 的补丁, 稳定, 永远不会失效过期'
  },
  {
    value: 'user',
    label: '自定义链接 (>100MB)',
    description: '此选项适合 >100MB 的补丁, 这需要您自行提供下载链接'
  }
]

export const SUPPORTED_RESOURCE_LINK_MAP: Record<string, string> = {
  touchgal: 'OtoAme 资源盘',
  s3: '对象存储下载',
  user: '自定义链接下载'
}

export const ALLOWED_MIME_TYPES = [
  'application/zip',
  'application/x-lz4',
  'application/x-rar-compressed'
]

export const ALLOWED_EXTENSIONS = ['.zip', '.rar', '.7z']

export const SUPPORTED_RESOURCE_SECTION = ['galgame', 'patch'] as const

export const RESOURCE_SECTION_MAP: Record<string, string> = {
  galgame: '游戏资源',
  patch: '工具补丁'
}

// 资源类型显示顺序，作为全站统一顺序来源
const TYPE_DISPLAY_ORDER = [...SUPPORTED_TYPE]

const TYPE_DISPLAY_PRIORITY: Record<string, number> = Object.fromEntries(
  TYPE_DISPLAY_ORDER.map((type, index) => [type, index])
)

/**
 * 对资源类型数组按显示顺序排序
 * 功能类型在前，语言类型在后
 */
export const sortResourceTypes = (types: string[]): string[] => {
  return [...types].sort((a, b) => {
    const priorityA = TYPE_DISPLAY_PRIORITY[a] ?? Number.MAX_SAFE_INTEGER
    const priorityB = TYPE_DISPLAY_PRIORITY[b] ?? Number.MAX_SAFE_INTEGER
    return priorityA - priorityB
  })
}

// 平台优先级排序 (索引越小优先级越高)
const PLATFORM_PRIORITY: Record<string, number> = Object.fromEntries(
  SUPPORTED_PLATFORM.map((platform, index) => [platform, index])
)

// 语言优先级排序 (索引越小优先级越高)
const LANGUAGE_PRIORITY: Record<string, number> = Object.fromEntries(
  SUPPORTED_LANGUAGE.map((language, index) => [language, index])
)

/**
 * 获取资源平台数组中的最高优先级 (数值越小优先级越高)
 */
export const getResourcePlatformPriority = (platforms: string[]): number => {
  if (!platforms.length) return Number.MAX_SAFE_INTEGER
  return Math.min(
    ...platforms.map((p) => PLATFORM_PRIORITY[p] ?? Number.MAX_SAFE_INTEGER)
  )
}

/**
 * 获取资源语言数组中的最高优先级 (数值越小优先级越高)
 */
export const getResourceLanguagePriority = (languages: string[]): number => {
  if (!languages.length) return Number.MAX_SAFE_INTEGER
  return Math.min(
    ...languages.map((l) => LANGUAGE_PRIORITY[l] ?? Number.MAX_SAFE_INTEGER)
  )
}

/**
 * 资源排序比较函数
 * 首先按平台优先级排序，如果相同则按语言优先级排序
 */
export const compareResources = <
  T extends { platform: string[]; language: string[] }
>(
  a: T,
  b: T
): number => {
  const platformPriorityA = getResourcePlatformPriority(a.platform)
  const platformPriorityB = getResourcePlatformPriority(b.platform)

  if (platformPriorityA !== platformPriorityB) {
    return platformPriorityA - platformPriorityB
  }

  const languagePriorityA = getResourceLanguagePriority(a.language)
  const languagePriorityB = getResourceLanguagePriority(b.language)

  return languagePriorityA - languagePriorityB
}
