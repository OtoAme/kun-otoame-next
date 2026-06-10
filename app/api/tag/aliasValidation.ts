import { prisma } from '~/prisma/index'
import { normalizeStringArray } from '~/utils/normalizeStringArray'

export const assertTagAliasAvailable = async (
  aliases: string[],
  currentTagId?: number
) => {
  const normalizedAliases = normalizeStringArray(aliases)
  if (!normalizedAliases.length) {
    return null
  }

  const conflictingTag = await prisma.patch_tag.findFirst({
    where: {
      id: currentTagId ? { not: currentTagId } : undefined,
      OR: normalizedAliases.map((alias) => ({
        OR: [{ name: alias }, { alias: { has: alias } }]
      }))
    },
    select: { id: true }
  })

  return conflictingTag ? '这个标签别名已经被其它标签使用了' : null
}
