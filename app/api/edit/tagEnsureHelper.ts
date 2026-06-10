import type { Prisma } from '@prisma/client'

export interface CanonicalTag {
  id: number
  name: string
  alias: string[]
}

export const buildTagLookupWhere = (
  tagNames: string[]
): Prisma.patch_tagWhereInput => ({
  OR: tagNames.length
    ? tagNames.map((tag) => ({
        OR: [{ name: tag }, { alias: { has: tag } }]
      }))
    : [{ id: { in: [] } }]
})

export const mapTagNamesToIds = <T extends CanonicalTag>(tags: T[]) => {
  const nameToId = new Map<string, number>()
  const aliasToIds = new Map<string, Set<number>>()

  for (const tag of tags) {
    if (!nameToId.has(tag.name)) {
      nameToId.set(tag.name, tag.id)
    }
    for (const alias of tag.alias) {
      const tagIds = aliasToIds.get(alias) ?? new Set<number>()
      tagIds.add(tag.id)
      aliasToIds.set(alias, tagIds)
    }
  }

  const tagNameToId = new Map(nameToId)
  for (const [alias, tagIds] of aliasToIds) {
    if (tagIds.size === 1) {
      tagNameToId.set(alias, [...tagIds][0])
    } else {
      tagNameToId.delete(alias)
    }
  }

  return tagNameToId
}

export const hasTagName = (
  tag: Pick<CanonicalTag, 'name' | 'alias'>,
  tagNames: Set<string>
) => tagNames.has(tag.name) || tag.alias.some((alias) => tagNames.has(alias))

export const hasAnyTagName = (
  tags: Pick<CanonicalTag, 'name' | 'alias'>[],
  tagName: string
) => tags.some((tag) => hasTagName(tag, new Set([tagName])))

export const getCanonicalTagIds = (
  tagNames: string[],
  tagNameToId: Map<string, number>
) => [
  ...new Set(
    tagNames
      .map((tag) => tagNameToId.get(tag))
      .filter((tagId): tagId is number => typeof tagId === 'number')
  )
]
