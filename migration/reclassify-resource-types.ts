import {
  normalizeTypesBySection,
  type ResourceSection
} from '../constants/resource'
import { prisma } from '../prisma'

interface ResourceRow {
  id: number
  name: string
  section: string
  type: string[]
  platform: string[]
  patch_id: number
  patch: {
    unique_id: string
    name: string
  }
}

const SITE_URL =
  process.env.KUN_SITE_URL ||
  process.env.NEXT_PUBLIC_KUN_SITE_URL ||
  'https://www.otoame.top'

const buildPatchPermalink = (uniqueId: string) => {
  return `${SITE_URL.replace(/\/$/, '')}/${uniqueId}`
}

const isResourceSection = (value: string): value is ResourceSection => {
  return value === 'galgame' || value === 'patch'
}

const arraysEqual = (a: string[], b: string[]) => {
  if (a.length !== b.length) return false
  return a.every((value, index) => value === b[index])
}

const MOBILE_ENGINE_PLATFORMS = new Set(['krkr', 'ons'])

const PS2_IN_NAME_REGEX = /ps2/i

const STRATEGY_KEYWORDS = [
  '攻略',
  'guide',
  'walkthrough',
  '路线',
  '图文攻略',
  '图片攻略'
]

const SAVE_KEYWORDS = ['存档', 'save', '全开', '完美存档', 'clear data']

const TOOL_KEYWORDS = [
  '工具',
  'tool',
  '注册表',
  'cheat',
  '修改器',
  '补丁',
  'patch',
  '修复'
]

const includesAnyKeyword = (text: string, keywords: string[]) => {
  const lower = text.toLowerCase()
  return keywords.some((keyword) => lower.includes(keyword.toLowerCase()))
}

const inferPatchTypeFromResourceName = (name: string): string | null => {
  if (includesAnyKeyword(name, STRATEGY_KEYWORDS)) return 'strategy'
  if (includesAnyKeyword(name, SAVE_KEYWORDS)) return 'save'
  if (includesAnyKeyword(name, TOOL_KEYWORDS)) return 'tool'
  return null
}

const remapEmulatorToMobileByPlatform = (
  types: string[],
  platforms: string[]
): string[] => {
  if (!types.includes('emulator')) {
    return types
  }

  const hasMobileEnginePlatform = platforms.some((platform) =>
    MOBILE_ENGINE_PLATFORMS.has(platform)
  )

  if (!hasMobileEnginePlatform) {
    return types
  }

  return Array.from(new Set(types.map((type) => (type === 'emulator' ? 'mobile' : type))))
}

const remapPlayStationPlatforms = (
  platforms: string[],
  resourceName: string
): string[] => {
  if (!platforms.includes('ps')) {
    return platforms
  }

  const isPs2Resource = PS2_IN_NAME_REGEX.test(resourceName)

  return Array.from(
    new Set(
      platforms.map((platform) => {
        if (platform !== 'ps') {
          return platform
        }
        return isPs2Resource ? 'ps2' : 'psv'
      })
    )
  )
}

const recalculatePatchAttributes = async (patchIds: number[]) => {
  if (!patchIds.length) return 0

  const resources = await prisma.patch_resource.findMany({
    where: { patch_id: { in: patchIds } },
    select: {
      patch_id: true,
      type: true,
      language: true,
      platform: true
    }
  })

  const patchAttrs = new Map<
    number,
    { type: Set<string>; language: Set<string>; platform: Set<string> }
  >()

  for (const res of resources) {
    const attrs = patchAttrs.get(res.patch_id) ?? {
      type: new Set<string>(),
      language: new Set<string>(),
      platform: new Set<string>()
    }

    res.type.forEach((type) => attrs.type.add(type))
    res.language.forEach((language) => attrs.language.add(language))
    res.platform.forEach((platform) => attrs.platform.add(platform))
    patchAttrs.set(res.patch_id, attrs)
  }

  await prisma.$transaction(
    patchIds.map((patchId) => {
      const attrs = patchAttrs.get(patchId)
      return prisma.patch.update({
        where: { id: patchId },
        data: {
          type: Array.from(attrs?.type ?? []),
          language: Array.from(attrs?.language ?? []),
          platform: Array.from(attrs?.platform ?? []),
          resource_update_time: new Date()
        }
      })
    })
  )

  return patchIds.length
}

async function main() {
  const isApplyMode = process.argv.includes('--apply')
  const allowEmptyType = process.argv.includes('--allow-empty-type')
  let remappedEmulatorToMobileCount = 0
  let remappedPsToPsvCount = 0
  let remappedPsToPs2Count = 0
  let inferredPatchTypeCount = 0

  const resources = (await prisma.patch_resource.findMany({
    select: {
      id: true,
      name: true,
      section: true,
      type: true,
      platform: true,
      patch_id: true,
      patch: {
        select: {
          unique_id: true,
          name: true
        }
      }
    }
  })) as ResourceRow[]

  const updates: Array<{
    id: number
    patchId: number
    patchUniqueId: string
    patchName: string
    resourceName: string
    permalink: string
    section: string
    oldType: string[]
    oldPlatform: string[]
    type: string[]
    platform: string[]
  }> = []

  const emptyTypeUpdates: Array<{
    id: number
    patchId: number
    permalink: string
    patchName: string
    resourceName: string
    section: string
    oldType: string[]
    newPlatform: string[]
  }> = []

  for (const resource of resources) {
    const nextPlatforms = remapPlayStationPlatforms(
      resource.platform,
      resource.name
    )
    if (!arraysEqual(resource.platform, nextPlatforms)) {
      if (PS2_IN_NAME_REGEX.test(resource.name)) {
        remappedPsToPs2Count += 1
      } else {
        remappedPsToPsvCount += 1
      }
    }

    let nextTypes = resource.type

    if (isResourceSection(resource.section)) {
      const platformRemappedTypes = remapEmulatorToMobileByPlatform(
        resource.type,
        resource.platform
      )
      if (!arraysEqual(resource.type, platformRemappedTypes)) {
        remappedEmulatorToMobileCount += 1
      }

      nextTypes = normalizeTypesBySection(
        resource.section,
        platformRemappedTypes
      )

      if (resource.section === 'patch' && nextTypes.length === 0) {
        const inferredType = inferPatchTypeFromResourceName(resource.name)
        if (inferredType) {
          nextTypes = [inferredType]
          inferredPatchTypeCount += 1
        }
      }
    }

    const isTypeChanged = !arraysEqual(resource.type, nextTypes)
    const isPlatformChanged = !arraysEqual(resource.platform, nextPlatforms)

    if (isTypeChanged || isPlatformChanged) {
      const permalink = buildPatchPermalink(resource.patch.unique_id)

      updates.push({
        id: resource.id,
        patchId: resource.patch_id,
        patchUniqueId: resource.patch.unique_id,
        patchName: resource.patch.name,
        resourceName: resource.name,
        permalink,
        section: resource.section,
        oldType: resource.type,
        oldPlatform: resource.platform,
        type: nextTypes,
        platform: nextPlatforms
      })

      if (nextTypes.length === 0) {
        emptyTypeUpdates.push({
          id: resource.id,
          patchId: resource.patch_id,
          permalink,
          patchName: resource.patch.name,
          resourceName: resource.name,
          section: resource.section,
          oldType: resource.type,
          newPlatform: nextPlatforms
        })
      }
    }
  }

  const patchIds = Array.from(new Set(updates.map((item) => item.patchId)))

  if (!isApplyMode) {
    console.log('Dry run complete.')
    console.log(`Resources to update: ${updates.length}`)
    console.log(`Patches to recalculate: ${patchIds.length}`)
    console.log(
      `Resources remapped by rule (emulator + krkr/ons => mobile): ${remappedEmulatorToMobileCount}`
    )
    console.log(
      `Resources remapped by rule (ps in platform => psv): ${remappedPsToPsvCount}`
    )
    console.log(
      `Resources remapped by rule (ps in platform + name contains PS2 => ps2): ${remappedPsToPs2Count}`
    )
    console.log(
      `Resources inferred by rule (patch + empty type + name keywords => strategy/save/tool): ${inferredPatchTypeCount}`
    )
    console.log(`Resources with empty new_type after normalization: ${emptyTypeUpdates.length}`)

    if (updates.length > 0) {
      console.log('Preview (first 10 updates):')
      updates.slice(0, 10).forEach((item) => {
        console.log(
          `resource_id=${item.id}, patch_id=${item.patchId}, section=${item.section}, old_type=${JSON.stringify(item.oldType)}, new_type=${JSON.stringify(item.type)}, new_platform=${JSON.stringify(item.platform)}, permalink=${item.permalink}, patch_name=${JSON.stringify(item.patchName)}, resource_name=${JSON.stringify(item.resourceName)}, old_platform=${JSON.stringify(item.oldPlatform)}`
        )
      })
    }

    if (emptyTypeUpdates.length > 0) {
      console.log('Resources with empty new_type (first 50):')
      emptyTypeUpdates.slice(0, 50).forEach((item) => {
        console.log(
          `resource_id=${item.id}, patch_id=${item.patchId}, section=${item.section}, old_type=${JSON.stringify(item.oldType)}, new_type=[], new_platform=${JSON.stringify(item.newPlatform)}, permalink=${item.permalink}, patch_name=${JSON.stringify(item.patchName)}, resource_name=${JSON.stringify(item.resourceName)}`
        )
      })
    }

    console.log('Run with --apply to execute migration.')
    return
  }

  if (!updates.length) {
    console.log('No resources need migration.')
    return
  }

  if (emptyTypeUpdates.length > 0 && !allowEmptyType) {
    console.error(
      `Blocked apply: ${emptyTypeUpdates.length} resources would become new_type=[]. Please review dry-run output first.`
    )
    console.error(
      'If you explicitly want to allow this, rerun with: pnpm migration:resource-type:apply -- --allow-empty-type'
    )
    process.exit(1)
  }

  await prisma.$transaction(
    updates.map((item) =>
      prisma.patch_resource.update({
        where: { id: item.id },
        data: { type: item.type, platform: item.platform }
      })
    )
  )

  const updatedPatchCount = await recalculatePatchAttributes(patchIds)

  console.log(`Migration applied. Updated resources: ${updates.length}`)
  console.log(`Recalculated patch attributes: ${updatedPatchCount}`)
  console.log(
    `Resources remapped by rule (emulator + krkr/ons => mobile): ${remappedEmulatorToMobileCount}`
  )
  console.log(
    `Resources remapped by rule (ps in platform => psv): ${remappedPsToPsvCount}`
  )
  console.log(
    `Resources remapped by rule (ps in platform + name contains PS2 => ps2): ${remappedPsToPs2Count}`
  )
  console.log(
    `Resources inferred by rule (patch + empty type + name keywords => strategy/save/tool): ${inferredPatchTypeCount}`
  )
  console.log(`Resources with empty new_type after normalization: ${emptyTypeUpdates.length}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
