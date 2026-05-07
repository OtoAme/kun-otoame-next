import 'dotenv/config'
import { prisma } from '~/prisma/index'
import { lowQualityTags } from '~/lib/bgmDirtyTag'
import { lowQualitySteamTags } from '~/lib/steamDirtyTag'

const shouldApply = process.argv.includes('--apply')

const dirtyTagNames = Array.from(
  new Set([...lowQualityTags, ...lowQualitySteamTags].map((tag) => tag.trim()))
).filter(Boolean)

const removeBlockedTagIds = async (tagIds: number[]) => {
  if (!tagIds.length) {
    return
  }

  const tagIdSet = new Set(tagIds)
  const users = await prisma.user.findMany({
    where: {
      OR: tagIds.map((tagId) => ({
        blocked_tag_ids: { has: tagId }
      }))
    },
    select: {
      id: true,
      blocked_tag_ids: true
    }
  })
  if (!users.length) {
    return
  }

  await prisma.$transaction(
    users.map((user) =>
      prisma.user.update({
        where: { id: user.id },
        data: {
          blocked_tag_ids: user.blocked_tag_ids.filter(
            (tagId) => !tagIdSet.has(tagId)
          )
        }
      })
    )
  )
}

const run = async () => {
  const tags = await prisma.patch_tag.findMany({
    where: { name: { in: dirtyTagNames } },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      name: true,
      count: true,
      _count: {
        select: {
          patch_relation: true
        }
      },
      patch_relation: {
        select: {
          patch: {
            select: {
              unique_id: true
            }
          }
        }
      }
    }
  })

  const tagIds = tags.map((tag) => tag.id)
  const affectedUniqueIds = [
    ...new Set(
      tags.flatMap((tag) =>
        tag.patch_relation.map((relation) => relation.patch.unique_id)
      )
    )
  ]
  const relationCount = tags.reduce(
    (sum, tag) => sum + tag._count.patch_relation,
    0
  )

  console.log(
    `${shouldApply ? 'Applying' : 'Dry run'} dirty tag cleanup with ${dirtyTagNames.length} configured dirty tag names.`
  )
  console.log(`Matched tags: ${tags.length}`)
  console.log(`Matched tag relations: ${relationCount}`)
  console.log(`Affected patches: ${affectedUniqueIds.length}`)

  if (tags.length) {
    console.log('Matched dirty tags:')
    for (const tag of tags) {
      console.log(
        `  #${tag.id} ${tag.name} (count=${tag.count}, relations=${tag._count.patch_relation})`
      )
    }
  }

  if (!shouldApply) {
    console.log('No data changed. Re-run with --apply to delete these tags.')
    return
  }

  if (!tagIds.length) {
    console.log('No dirty tags found. Nothing to delete.')
    return
  }

  await prisma.$transaction(async (prisma) => {
    await prisma.patch_tag_relation.deleteMany({
      where: { tag_id: { in: tagIds } }
    })

    await prisma.patch_tag.deleteMany({
      where: { id: { in: tagIds } }
    })
  })

  await removeBlockedTagIds(tagIds)

  try {
    const {
      invalidatePatchContentCache,
      invalidatePatchListCaches,
      invalidateTagCaches
    } = await import('../app/api/patch/cache')
    const { redis } = await import('../lib/redis')

    try {
      await Promise.all([
        invalidateTagCaches(),
        invalidatePatchListCaches(),
        ...affectedUniqueIds.map((uniqueId) =>
          invalidatePatchContentCache(uniqueId)
        )
      ])
    } finally {
      redis.disconnect()
    }
  } catch (error) {
    console.error('Dirty tags were deleted, but cache invalidation failed:')
    console.error(error)
    process.exitCode = 1
  }

  console.log(
    `Deleted ${tags.length} dirty tags and ${relationCount} tag relations.`
  )
}

run()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
