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
  let remappedEmulatorToMobileCount = 0
  let remappedPsToPsvCount = 0
  let remappedPsToPs2Count = 0

  const resources = (await prisma.patch_resource.findMany({
    select: {
      id: true,
      name: true,
      section: true,
      type: true,
      platform: true,
      patch_id: true
    }
  })) as ResourceRow[]

  const updates: Array<{
    id: number
    patchId: number
    type: string[]
    platform: string[]
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
    }

    const isTypeChanged = !arraysEqual(resource.type, nextTypes)
    const isPlatformChanged = !arraysEqual(resource.platform, nextPlatforms)

    if (isTypeChanged || isPlatformChanged) {
      updates.push({
        id: resource.id,
        patchId: resource.patch_id,
        type: nextTypes,
        platform: nextPlatforms
      })
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

    if (updates.length > 0) {
      console.log('Preview (first 10 updates):')
      updates.slice(0, 10).forEach((item) => {
        console.log(
          `resource_id=${item.id}, patch_id=${item.patchId}, new_type=${JSON.stringify(item.type)}, new_platform=${JSON.stringify(item.platform)}`
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
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
