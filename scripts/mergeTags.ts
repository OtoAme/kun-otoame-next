import 'dotenv/config'
import { readFile } from 'fs/promises'
import { prisma } from '~/prisma/index'
import {
  buildAutoAliasMergePlan,
  getMergePreview,
  type MergePreviewTag,
  type MergeTagsPlan
} from './tagMergePlan'

const shouldApply = process.argv.includes('--apply')
const shouldAutoAlias = process.argv.includes('--auto-alias')

const getArgValue = (name: string) => {
  const prefix = `${name}=`
  const match = process.argv.find((arg) => arg.startsWith(prefix))
  return match?.slice(prefix.length)
}

type PlanValidationResult = {
  errors: string[]
  warnings: string[]
}

type PatchRelationWithUniqueId = {
  patch_id: number
  patch?: {
    unique_id: string
  } | null
}

type TagById = Map<number, MergePreviewTag>

const PATCH_CONTENT_CACHE_BATCH_SIZE = 100

const unique = <T>(values: T[]) => [...new Set(values)]

const collectAffectedUniqueIds = (relations: PatchRelationWithUniqueId[]) =>
  unique(
    relations
      .map((relation) => relation.patch?.unique_id)
      .filter((uniqueId): uniqueId is string => typeof uniqueId === 'string')
  )

const readPlan = async (): Promise<MergeTagsPlan> => {
  const planPath = getArgValue('--plan')
  if (!planPath) {
    if (shouldAutoAlias) {
      return {}
    }
    throw new Error('Missing --plan=path/to/merge-plan.json or --auto-alias')
  }

  const content = await readFile(planPath, 'utf8')
  return JSON.parse(content) as MergeTagsPlan
}

const getDeleteTagId = (
  deleteTag: NonNullable<MergeTagsPlan['deletes']>[number]
) => (typeof deleteTag === 'number' ? deleteTag : deleteTag.tagId)

const getDeleteTagName = (
  deleteTag: NonNullable<MergeTagsPlan['deletes']>[number]
) => (typeof deleteTag === 'number' ? undefined : deleteTag.name)

const validatePlan = async (
  merges: Required<MergeTagsPlan>['merges'],
  deletes: NonNullable<MergeTagsPlan['deletes']>
): Promise<PlanValidationResult> => {
  const errors: string[] = []
  const warnings: string[] = []
  const tagIds = new Set<number>()
  const sourceOwnerById = new Map<number, number>()
  const deleteTagIds = new Set(deletes.map(getDeleteTagId))

  for (const merge of merges) {
    tagIds.add(merge.targetTagId)
    for (const tagId of merge.sourceTagIds) {
      tagIds.add(tagId)
      const currentOwner = sourceOwnerById.get(tagId)
      if (currentOwner && currentOwner !== merge.targetTagId) {
        errors.push(
          `Source tag #${tagId} appears in multiple merge targets: #${currentOwner}, #${merge.targetTagId}`
        )
      } else {
        sourceOwnerById.set(tagId, merge.targetTagId)
      }
    }
  }
  for (const deleteTag of deletes) {
    tagIds.add(getDeleteTagId(deleteTag))
  }

  if (!tagIds.size) {
    return { errors, warnings }
  }

  const tags = await prisma.patch_tag.findMany({
    where: { id: { in: [...tagIds] } },
    select: { id: true, name: true }
  })
  const tagsById = new Map(tags.map((tag) => [tag.id, tag]))

  for (const merge of merges) {
    const targetTag = tagsById.get(merge.targetTagId)
    if (!targetTag) {
      errors.push(`Target tag #${merge.targetTagId} not found`)
    } else if (merge.targetName && targetTag.name !== merge.targetName) {
      errors.push(
        `Target tag #${merge.targetTagId} name mismatch: expected ${merge.targetName}, got ${targetTag.name}`
      )
    }
    if (deleteTagIds.has(merge.targetTagId)) {
      errors.push(`Target tag #${merge.targetTagId} cannot also be deleted`)
    }

    for (const [index, tagId] of merge.sourceTagIds.entries()) {
      if (tagId === merge.targetTagId) {
        errors.push(`Source tag #${tagId} cannot equal target tag`)
        continue
      }
      if (deleteTagIds.has(tagId)) {
        errors.push(`Source tag #${tagId} cannot also be deleted`)
      }
      if (sourceOwnerById.has(merge.targetTagId)) {
        errors.push(
          `Target tag #${merge.targetTagId} cannot also be a source tag`
        )
      }

      const sourceTag = tagsById.get(tagId)
      const expectedName = merge.sourceNames?.[index]
      if (!sourceTag) {
        warnings.push(`skip missing source tag #${tagId}`)
      } else if (expectedName && sourceTag.name !== expectedName) {
        errors.push(
          `Source tag #${tagId} name mismatch: expected ${expectedName}, got ${sourceTag.name}`
        )
      }
    }
  }

  for (const deleteTag of deletes) {
    const tagId = getDeleteTagId(deleteTag)
    const expectedName = getDeleteTagName(deleteTag)
    const tag = tagsById.get(tagId)
    if (!tag) {
      warnings.push(`skip missing delete tag #${tagId}`)
    } else if (expectedName && tag.name !== expectedName) {
      errors.push(
        `Delete tag #${tagId} name mismatch: expected ${expectedName}, got ${tag.name}`
      )
    }
  }

  return { errors, warnings }
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

    if (
      targetTagId &&
      user.blocked_tag_ids.some((tagId) => sourceTagIdSet.has(tagId))
    ) {
      nextBlockedTagIds.push(targetTagId)
    }

    return {
      id: user.id,
      blockedTagIds: [...new Set(nextBlockedTagIds)]
    }
  })
}

const logMergePreview = (
  targetTag: MergePreviewTag,
  sourceTags: MergePreviewTag[],
  relationCount: number,
  nextAliases: string[]
) => {
  console.log(
    `${shouldApply ? 'Applying' : 'Dry run'} merge into #${targetTag.id} ${targetTag.name}`
  )
  for (const tag of sourceTags) {
    console.log(
      `  merge #${tag.id} ${tag.name} (count=${tag.count}, relations=${tag._count.patch_relation})`
    )
  }
  console.log(`  source relations: ${relationCount}`)
  console.log(`  next aliases: ${nextAliases.join(', ') || '(none)'}`)
}

const collectMergeTagIds = (merges: Required<MergeTagsPlan>['merges']) => [
  ...new Set(
    merges.flatMap((merge) => [merge.targetTagId, ...merge.sourceTagIds])
  )
]

const loadMergeTagsById = async (
  merges: Required<MergeTagsPlan>['merges']
): Promise<TagById> => {
  const tagIds = collectMergeTagIds(merges)
  if (!tagIds.length) {
    return new Map()
  }

  const tags = await prisma.patch_tag.findMany({
    where: { id: { in: tagIds } },
    select: {
      id: true,
      name: true,
      alias: true,
      count: true,
      _count: { select: { patch_relation: true } }
    }
  })

  return new Map(tags.map((tag) => [tag.id, tag]))
}

const mergeTags = async (
  plan: Required<MergeTagsPlan>['merges'][number],
  tagsById: TagById
) => {
  const expectedSourceNamesById = new Map(
    plan.sourceTagIds.map((tagId, index) => [tagId, plan.sourceNames?.[index]])
  )
  const sourceTagIds = [...new Set(plan.sourceTagIds)].filter(
    (tagId) => tagId !== plan.targetTagId
  )
  if (!sourceTagIds.length) {
    return []
  }

  const targetTag = tagsById.get(plan.targetTagId)
  const sourceTags = sourceTagIds
    .map((tagId) => tagsById.get(tagId))
    .filter((tag): tag is MergePreviewTag => Boolean(tag))

  if (!targetTag) {
    throw new Error(`Target tag #${plan.targetTagId} not found`)
  }
  if (plan.targetName && targetTag.name !== plan.targetName) {
    throw new Error(
      `Target tag #${plan.targetTagId} name mismatch: expected ${plan.targetName}, got ${targetTag.name}`
    )
  }

  const mismatchedSourceTags = sourceTags.filter((tag) => {
    const expectedName = expectedSourceNamesById.get(tag.id)
    return expectedName && tag.name !== expectedName
  })
  if (mismatchedSourceTags.length > 0) {
    throw new Error(
      `Source tag name mismatch: ${mismatchedSourceTags
        .map(
          (tag) =>
            `#${tag.id} expected ${expectedSourceNamesById.get(tag.id)}, got ${tag.name}`
        )
        .join('; ')}`
    )
  }

  const existingSourceTagIds = sourceTags.map((tag) => tag.id)
  if (sourceTags.length !== sourceTagIds.length) {
    const foundSourceIds = new Set(existingSourceTagIds)
    const missingSourceIds = sourceTagIds.filter(
      (tagId) => !foundSourceIds.has(tagId)
    )
    console.warn(`  skip missing source tags: ${missingSourceIds.join(', ')}`)
  }

  const preview = getMergePreview(targetTag, sourceTags, plan.aliases)
  logMergePreview(
    targetTag,
    sourceTags,
    preview.relationCount,
    preview.nextAliases
  )

  if (!shouldApply) {
    return []
  }

  const sourceRelations = await prisma.patch_tag_relation.findMany({
    where: { tag_id: { in: existingSourceTagIds } },
    select: {
      patch_id: true,
      tag_id: true,
      patch: {
        select: {
          unique_id: true
        }
      }
    }
  })
  const affectedUniqueIds = collectAffectedUniqueIds(sourceRelations)

  const userUpdates = await getBlockedTagUserUpdates(
    existingSourceTagIds,
    plan.targetTagId
  )

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
      where: { tag_id: { in: existingSourceTagIds } }
    })

    await tx.patch_tag.deleteMany({
      where: { id: { in: existingSourceTagIds } }
    })

    const actualCount = await tx.patch_tag_relation.count({
      where: { tag_id: plan.targetTagId }
    })

    await tx.patch_tag.update({
      where: { id: plan.targetTagId },
      data: {
        alias: preview.nextAliases,
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

  return affectedUniqueIds
}

const deleteTags = async (
  deleteTags: NonNullable<MergeTagsPlan['deletes']>
) => {
  const uniqueTagIds = [...new Set(deleteTags.map(getDeleteTagId))]
  if (!uniqueTagIds.length) {
    return []
  }

  const expectedTagNamesById = new Map(
    deleteTags.map((deleteTag) => [
      getDeleteTagId(deleteTag),
      getDeleteTagName(deleteTag)
    ])
  )

  const tags = await prisma.patch_tag.findMany({
    where: { id: { in: uniqueTagIds } },
    select: {
      id: true,
      name: true,
      count: true,
      _count: { select: { patch_relation: true } }
    }
  })

  if (tags.length !== uniqueTagIds.length) {
    const foundTagIds = new Set(tags.map((tag) => tag.id))
    const missingTagIds = uniqueTagIds.filter(
      (tagId) => !foundTagIds.has(tagId)
    )
    console.warn(`skip missing delete tags: ${missingTagIds.join(', ')}`)
  }

  const mismatchedTags = tags.filter((tag) => {
    const expectedName = expectedTagNamesById.get(tag.id)
    return expectedName && tag.name !== expectedName
  })
  if (mismatchedTags.length > 0) {
    throw new Error(
      `Delete tag name mismatch: ${mismatchedTags
        .map(
          (tag) =>
            `#${tag.id} expected ${expectedTagNamesById.get(tag.id)}, got ${tag.name}`
        )
        .join('; ')}`
    )
  }

  console.log(
    `${shouldApply ? 'Applying' : 'Dry run'} delete ${tags.length} tags`
  )
  for (const tag of tags) {
    console.log(
      `  delete #${tag.id} ${tag.name} (count=${tag.count}, relations=${tag._count.patch_relation})`
    )
  }

  if (!shouldApply || !tags.length) {
    return []
  }

  const existingTagIds = tags.map((tag) => tag.id)
  const tagRelations = await prisma.patch_tag_relation.findMany({
    where: { tag_id: { in: existingTagIds } },
    select: {
      patch_id: true,
      patch: {
        select: {
          unique_id: true
        }
      }
    }
  })
  const affectedUniqueIds = collectAffectedUniqueIds(tagRelations)
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

  return affectedUniqueIds
}

const invalidateCaches = async (affectedUniqueIds: string[]) => {
  try {
    const {
      invalidatePatchContentCache,
      invalidatePatchListCaches,
      invalidateTagCaches
    } = await import('../app/api/patch/cache')
    const { redis } = await import('../lib/redis')

    try {
      await Promise.all([invalidateTagCaches(), invalidatePatchListCaches()])
      for (
        let index = 0;
        index < affectedUniqueIds.length;
        index += PATCH_CONTENT_CACHE_BATCH_SIZE
      ) {
        await Promise.all(
          affectedUniqueIds
            .slice(index, index + PATCH_CONTENT_CACHE_BATCH_SIZE)
            .map((uniqueId) => invalidatePatchContentCache(uniqueId))
        )
      }
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
  let merges = plan.merges ?? []
  const deletes = plan.deletes ?? []

  if (shouldAutoAlias) {
    const tags = await prisma.patch_tag.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, name: true, alias: true }
    })
    const autoPlan = buildAutoAliasMergePlan(tags)
    for (const warning of autoPlan.warnings) {
      console.warn(`  ${warning}`)
    }
    merges = [...merges, ...autoPlan.merges]
  }

  console.log(
    `${shouldApply ? 'Applying' : 'Dry run'} tag merge plan with ${merges.length} merges and ${deletes.length} deletes.`
  )

  const validation = await validatePlan(merges, deletes)
  for (const warning of validation.warnings) {
    console.warn(`  ${warning}`)
  }
  if (validation.errors.length > 0) {
    console.error(
      `Tag merge plan validation failed with ${validation.errors.length} errors:`
    )
    for (const error of validation.errors) {
      console.error(`  - ${error}`)
    }
    process.exitCode = 1
    return
  }

  const affectedUniqueIdSet = new Set<string>()
  const mergeTagsById = await loadMergeTagsById(merges)
  for (const merge of merges) {
    for (const uniqueId of await mergeTags(merge, mergeTagsById)) {
      affectedUniqueIdSet.add(uniqueId)
    }
  }
  for (const uniqueId of await deleteTags(deletes)) {
    affectedUniqueIdSet.add(uniqueId)
  }
  const affectedUniqueIds = [...affectedUniqueIdSet]

  if (!shouldApply) {
    console.log('Affected patch content caches: skipped in dry run for speed.')
    console.log('No data changed. Re-run with --apply to execute this plan.')
    return
  }

  console.log(`Affected patch content caches: ${affectedUniqueIds.length}`)
  await invalidateCaches(affectedUniqueIds)
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
