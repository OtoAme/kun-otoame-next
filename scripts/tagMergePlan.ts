export type MergeTagsPlan = {
  merges?: Array<{
    targetTagId: number
    targetName?: string
    sourceTagIds: number[]
    sourceNames?: string[]
    aliases?: string[]
  }>
  deletes?: Array<number | { tagId: number; name?: string }>
}

export interface AutoAliasTag {
  id: number
  name: string
  alias: string[]
}

export interface MergePreviewTag {
  id: number
  name: string
  alias: string[]
  count: number
  _count: {
    patch_relation: number
  }
}

export type AutoAliasMergePlanResult = {
  merges: Required<MergeTagsPlan>['merges']
  warnings: string[]
}

export const normalizeAliases = (aliases: string[]) => [
  ...new Set(aliases.map((alias) => alias.trim()).filter(Boolean))
]

export const getMergePreview = (
  targetTag: MergePreviewTag,
  sourceTags: MergePreviewTag[],
  planAliases: string[] = []
) => {
  const relationCount = sourceTags.reduce(
    (sum, tag) => sum + tag._count.patch_relation,
    0
  )
  const nextAliases = normalizeAliases([
    ...targetTag.alias,
    ...sourceTags.map((tag) => tag.name),
    ...sourceTags.flatMap((tag) => tag.alias),
    ...planAliases
  ]).filter((alias) => alias !== targetTag.name)

  return { relationCount, nextAliases }
}

const getAliasTargetsByName = (tags: AutoAliasTag[]) => {
  const tagNameSet = new Set(tags.map((tag) => tag.name))
  const aliasTargets = new Map<string, AutoAliasTag[]>()

  for (const tag of tags) {
    for (const alias of normalizeAliases(tag.alias)) {
      if (!tagNameSet.has(alias) || alias === tag.name) {
        continue
      }

      const targets = aliasTargets.get(alias) ?? []
      targets.push(tag)
      aliasTargets.set(alias, targets)
    }
  }

  return aliasTargets
}

const resolveRootTargetId = (
  sourceId: number,
  sourceToTargetId: Map<number, number>
) => {
  const seen = new Set<number>()
  let currentId = sourceId

  while (sourceToTargetId.has(currentId)) {
    if (seen.has(currentId)) {
      return null
    }
    seen.add(currentId)
    currentId = sourceToTargetId.get(currentId)!
  }

  return currentId === sourceId ? null : currentId
}

export const buildAutoAliasMergePlan = (
  tags: AutoAliasTag[]
): AutoAliasMergePlanResult => {
  const warnings: string[] = []
  const tagsById = new Map(tags.map((tag) => [tag.id, tag]))
  const tagsByName = new Map(tags.map((tag) => [tag.name, tag]))
  const aliasTargets = getAliasTargetsByName(tags)
  const sourceToTargetId = new Map<number, number>()
  const ambiguousSourceIds = new Set<number>()

  for (const [sourceName, targets] of aliasTargets) {
    const source = tagsByName.get(sourceName)
    if (!source) {
      continue
    }

    const distinctTargets = targets.filter((target) => target.id !== source.id)
    if (!distinctTargets.length) {
      continue
    }

    const targetIds = [...new Set(distinctTargets.map((target) => target.id))]
    if (targetIds.length > 1) {
      ambiguousSourceIds.add(source.id)
      warnings.push(
        `Skip ambiguous alias tag "${sourceName}" (#${source.id}); matched targets ${distinctTargets
          .map((tag) => `#${tag.id} ${tag.name}`)
          .join(', ')}`
      )
      continue
    }

    sourceToTargetId.set(source.id, targetIds[0])
  }

  const sourcesByRootTarget = new Map<number, AutoAliasTag[]>()
  for (const sourceId of sourceToTargetId.keys()) {
    const rootTargetId = resolveRootTargetId(sourceId, sourceToTargetId)
    const source = tagsById.get(sourceId)
    if (!source) {
      continue
    }

    if (!rootTargetId) {
      warnings.push(
        `Skip cyclic alias tag "${source.name}" (#${source.id}); use a manual plan`
      )
      continue
    }

    const rootTarget = tagsById.get(rootTargetId)
    if (!rootTarget) {
      warnings.push(
        `Skip alias tag "${source.name}" (#${source.id}); resolved target #${rootTargetId} is missing`
      )
      continue
    }

    if (ambiguousSourceIds.has(rootTarget.id)) {
      warnings.push(
        `Skip alias chain for "${source.name}" (#${source.id}); root target #${rootTarget.id} ${rootTarget.name} is ambiguous`
      )
      continue
    }

    const sources = sourcesByRootTarget.get(rootTargetId) ?? []
    sources.push(source)
    sourcesByRootTarget.set(rootTargetId, sources)
  }

  const merges = [...sourcesByRootTarget.entries()]
    .map(([targetTagId, sources]) => {
      const target = tagsById.get(targetTagId)!
      const uniqueSources = [
        ...new Map(sources.map((source) => [source.id, source])).values()
      ].filter((source) => source.id !== targetTagId)

      return {
        targetTagId,
        targetName: target.name,
        sourceTagIds: uniqueSources.map((source) => source.id),
        sourceNames: uniqueSources.map((source) => source.name)
      }
    })
    .filter((merge) => merge.sourceTagIds.length > 0)
    .sort((a, b) => a.targetTagId - b.targetTagId)

  return { merges, warnings }
}
