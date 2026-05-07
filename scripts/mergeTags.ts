import 'dotenv/config'
import { readFile } from 'fs/promises'
import { prisma } from '~/prisma/index'

const shouldApply = process.argv.includes('--apply')

const getArgValue = (name: string) => {
  const prefix = `${name}=`
  const match = process.argv.find((arg) => arg.startsWith(prefix))
  return match?.slice(prefix.length)
}

type MergeTagsPlan = {
  merges?: Array<{
    targetTagId: number
    sourceTagIds: number[]
    aliases?: string[]
  }>
  deletes?: number[]
}

const normalizeAliases = (aliases: string[]) => [
  ...new Set(aliases.map((alias) => alias.trim()).filter(Boolean))
]

const readPlan = async (): Promise<MergeTagsPlan> => {
  const planPath = getArgValue('--plan')
  if (!planPath) {
    throw new Error('Missing --plan=path/to/merge-plan.json')
  }

  const content = await readFile(planPath, 'utf8')
  return JSON.parse(content) as MergeTagsPlan
}

const getBlockedTagUserUpdates = async (
  sourceTagIds: number[],
  targetTagId?: number
) => {
  if (!sourceTagIds.length) {
    return []
  }

  const sourceTagIdSet = new Set(sourceTagIds)
  const users = await prisma.user.findMany({
    where: {
      OR: sourceTagIds.map((tagId) => ({
        blocked_tag_ids: { has: tagId }
      }))
    },
    select: {
      id: true,
      blocked_tag_ids: true
    }
  })

  return users.map((user) => {
    const nextBlockedTagIds = user.blocked_tag_ids.filter(
      (tagId) => !sourceTagIdSet.has(tagId)
    )

    if (targetTagId && user.blocked_tag_ids.some((tagId) => sourceTagIdSet.has(tagId))) {
      nextBlockedTagIds.push(targetTagId)
    }

    return {
      id: user.id,
      blockedTagIds: [...new Set(nextBlockedTagIds)]
    }
  })
}

const mergeTags = async (plan: Required<MergeTagsPlan>['merges'][number]) => {
  const sourceTagIds = [...new Set(plan.sourceTagIds)].filter(
    (tagId) => tagId !== plan.targetTagId
  )
  if (!sourceTagIds.length) {
    return
  }

  const tags = await prisma.patch_tag.findMany({
    where: { id: { in: [plan.targetTagId, ...sourceTagIds] } },
    select: {
      id: true,
      name: true,
      alias: true,
      count: true,
      _count: { select: { patch_relation: true } }
    }
  })
  const targetTag = tags.find((tag) => tag.id === plan.targetTagId)
  const sourceTags = tags.filter((tag) => sourceTagIds.includes(tag.id))

  if (!targetTag) {
    throw new Error(`Target tag #${plan.targetTagId} not found`)
  }
  if (sourceTags.length !== sourceTagIds.length) {
    const foundSourceIds = new Set(sourceTags.map((tag) => tag.id))
    const missingSourceIds = sourceTagIds.filter((tagId) => !foundSourceIds.has(tagId))
    throw new Error(`Source tags not found: ${missingSourceIds.join(', ')}`)
  }

  const sourceRelations = await prisma.patch_tag_relation.findMany({
    where: { tag_id: { in: sourceTagIds } },
    select: { patch_id: true, tag_id: true }
  })
  const affectedPatches = [...new Set(sourceRelations.map((relation) => relation.patch_id))]
  const nextAliases = normalizeAliases([
    ...targetTag.alias,
    ...sourceTags.map((tag) => tag.name),
    ...sourceTags.flatMap((tag) => tag.alias),
    ...(plan.aliases ?? [])
  ]).filter((alias) => alias !== targetTag.name)

  console.log(
    `${shouldApply ? 'Applying' : 'Dry run'} merge into #${targetTag.id} ${targetTag.name}`
  )
  for (const tag of sourceTags) {
    console.log(
      `  merge #${tag.id} ${tag.name} (count=${tag.count}, relations=${tag._count.patch_relation})`
    )
  }
  console.log(`  relations to move: ${sourceRelations.length}`)
  console.log(`  affected patches: ${affectedPatches.length}`)
  console.log(`  next aliases: ${nextAliases.join(', ') || '(none)'}`)

  if (!shouldApply) {
    return
  }

  const userUpdates = await getBlockedTagUserUpdates(sourceTagIds, plan.targetTagId)

  await prisma.$transaction(async (tx) => {
    if (sourceRelations.length) {
      await tx.patch_tag_relation.createMany({
        data: sourceRelations.map((relation) => ({
          patch_id: relation.patch_id,
          tag_id: plan.targetTagId
        })),
        skipDuplicates: true
      })
    }

    await tx.patch_tag_relation.deleteMany({
      where: { tag_id: { in: sourceTagIds } }
    })

    await tx.patch_tag.deleteMany({
      where: { id: { in: sourceTagIds } }
    })

    const actualCount = await tx.patch_tag_relation.count({
      where: { tag_id: plan.targetTagId }
    })

    await tx.patch_tag.update({
      where: { id: plan.targetTagId },
      data: {
        alias: nextAliases,
        count: actualCount
      }
    })

    for (const userUpdate of userUpdates) {
      await tx.user.update({
        where: { id: userUpdate.id },
        data: { blocked_tag_ids: userUpdate.blockedTagIds }
      })
    }
  })
}

const deleteTags = async (tagIds: number[]) => {
  const uniqueTagIds = [...new Set(tagIds)]
  if (!uniqueTagIds.length) {
    return
  }

  const tags = await prisma.patch_tag.findMany({
    where: { id: { in: uniqueTagIds } },
    select: {
      id: true,
      name: true,
      count: true,
      _count: { select: { patch_relation: true } }
    }
  })

  console.log(`${shouldApply ? 'Applying' : 'Dry run'} delete ${tags.length} tags`)
  for (const tag of tags) {
    console.log(
      `  delete #${tag.id} ${tag.name} (count=${tag.count}, relations=${tag._count.patch_relation})`
    )
  }

  if (!shouldApply || !tags.length) {
    return
  }

  const existingTagIds = tags.map((tag) => tag.id)
  const userUpdates = await getBlockedTagUserUpdates(existingTagIds)

  await prisma.$transaction(async (tx) => {
    await tx.patch_tag_relation.deleteMany({
      where: { tag_id: { in: existingTagIds } }
    })

    await tx.patch_tag.deleteMany({
      where: { id: { in: existingTagIds } }
    })

    for (const userUpdate of userUpdates) {
      await tx.user.update({
        where: { id: userUpdate.id },
        data: { blocked_tag_ids: userUpdate.blockedTagIds }
      })
    }
  })
}

const invalidateCaches = async () => {
  try {
    const { invalidatePatchListCaches, invalidateTagCaches } = await import(
      '../app/api/patch/cache'
    )
    const { redis } = await import('../lib/redis')

    try {
      await Promise.all([invalidateTagCaches(), invalidatePatchListCaches()])
    } finally {
      redis.disconnect()
    }
  } catch (error) {
    console.error('Tags were updated, but cache invalidation failed:')
    console.error(error)
    process.exitCode = 1
  }
}

const run = async () => {
  const plan = await readPlan()
  const merges = plan.merges ?? []
  const deletes = plan.deletes ?? []

  console.log(
    `${shouldApply ? 'Applying' : 'Dry run'} tag merge plan with ${merges.length} merges and ${deletes.length} deletes.`
  )

  for (const merge of merges) {
    await mergeTags(merge)
  }
  await deleteTags(deletes)

  if (!shouldApply) {
    console.log('No data changed. Re-run with --apply to execute this plan.')
    return
  }

  await invalidateCaches()
  console.log('Tag merge plan applied.')
}

run()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
