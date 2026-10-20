import {
  CHINESE_SUPPORT_RESOURCE_TYPES,
  GAME_RESOURCE_TYPES,
  canSelectChineseSupportType,
  getAllowedPlatformsBySectionAndTypes,
  getResourceTypeOptionsBySection,
  type ResourceSection
} from '~/constants/resource'

/**
 * Non-UI resource form rules shared by the public HeroUI publisher and the
 * shadcn workspace editor. Category and platform data stay in
 * constants/resource.ts; this module only combines them.
 */

export const isChineseSupportType = (
  type: string
): type is (typeof CHINESE_SUPPORT_RESOURCE_TYPES)[number] =>
  CHINESE_SUPPORT_RESOURCE_TYPES.includes(
    type as (typeof CHINESE_SUPPORT_RESOURCE_TYPES)[number]
  )

export const splitTypesByChineseSupport = (types: string[]) => ({
  gameAndOther: types.filter((type) => !isChineseSupportType(type)),
  chineseSupport: types.filter(isChineseSupportType)
})

/** Type groups for the game section: game types first, then other types. */
export const getResourceTypeGroups = (section: ResourceSection) => {
  const resourceTypes = getResourceTypeOptionsBySection(section)
  const groups = [
    {
      key: 'game-types',
      title: '游戏类型',
      types: GAME_RESOURCE_TYPES as readonly string[]
    },
    {
      key: 'other-types',
      title: '其他类型',
      types: resourceTypes
        .map((type) => type.value)
        .filter(
          (type) =>
            !GAME_RESOURCE_TYPES.includes(
              type as (typeof GAME_RESOURCE_TYPES)[number]
            ) && !isChineseSupportType(type)
        )
    }
  ]
  return groups
    .map((group) => ({
      ...group,
      options: group.types.flatMap((typeValue) => {
        const option = resourceTypes.find((type) => type.value === typeValue)
        return option ? [option] : []
      })
    }))
    .filter((group) => group.options.length > 0)
}

export const getChineseSupportOptions = (section: ResourceSection) => {
  const resourceTypes = getResourceTypeOptionsBySection(section)
  return CHINESE_SUPPORT_RESOURCE_TYPES.flatMap((typeValue) => {
    const option = resourceTypes.find((type) => type.value === typeValue)
    return option ? [option] : []
  })
}

export interface ResourceTypeSelectionState {
  /** The merged type value stored on the resource. */
  types: string[]
  /** Types not applicable anymore after the change. */
  chineseSupportSelectable: boolean
  chineseSupportRequired: boolean
  /** Platforms still allowed for the new types, filtered from the current. */
  platforms: string[]
}

/**
 * Apply a type change for a section: dedupe, drop inapplicable Chinese
 * support selections, and filter platforms to the still-allowed set.
 */
export const applyTypeChange = (
  section: ResourceSection,
  nextTypes: string[],
  currentPlatforms: string[]
): ResourceTypeSelectionState => {
  let types = Array.from(new Set(nextTypes))
  const chineseSupportSelectable = canSelectChineseSupportType(types)
  if (section === 'galgame' && !chineseSupportSelectable) {
    types = types.filter((type) => !isChineseSupportType(type))
  }
  const allowed = getAllowedPlatformsBySectionAndTypes(section, types)
  return {
    types,
    chineseSupportSelectable,
    chineseSupportRequired:
      section === 'galgame' && chineseSupportSelectable && hasGameType(types),
    platforms: currentPlatforms.filter((platform) => allowed.includes(platform))
  }
}

const hasGameType = (types: string[]) =>
  types.some((type) =>
    GAME_RESOURCE_TYPES.includes(type as (typeof GAME_RESOURCE_TYPES)[number])
  )

export const getDefaultLinkStorage = (section: string, role: number) => {
  if (role > 3) {
    return 'touchgal'
  }
  if (role > 1 && section === 'patch') {
    return 's3'
  }
  return 'user'
}

export const getDisabledStorageKeys = (section: string, role: number) => {
  if (role > 3) {
    return []
  }
  if (role > 1 && section === 'patch') {
    return ['touchgal']
  }
  return ['s3', 'touchgal']
}

export interface StorageLinkFields {
  storage: string
  content: string
  hash: string
  size: string
  code: string
  password: string
  uploadId?: string
}

/**
 * Switching away from s3 clears content/hash/uploadId; switching to s3 clears
 * only content. Size, code and password are never cleared by a switch.
 */
export const applyStorageSwitch = <T extends StorageLinkFields>(
  link: T,
  nextStorage: string
): T => {
  if (nextStorage === link.storage) return link
  if (nextStorage === 's3') {
    return { ...link, storage: nextStorage, content: '' }
  }
  const next = { ...link, storage: nextStorage, content: '', hash: '' }
  delete next.uploadId
  return next
}
