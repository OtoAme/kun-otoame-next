import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const adapter = new PrismaPg(process.env.KUN_DATABASE_URL!)
const prisma = new PrismaClient({ adapter })

const shouldApply = process.argv.includes('--apply')
const batchSize = 200

const sameSet = (left: string[], right: string[]) => {
  if (left.length !== right.length) return false

  const rightSet = new Set(right)
  return left.every((item) => rightSet.has(item))
}

const buildAttributes = (
  resources: {
    type: string[]
    language: string[]
    platform: string[]
  }[]
) => {
  const type = new Set<string>()
  const language = new Set<string>()
  const platform = new Set<string>()

  for (const resource of resources) {
    resource.type.forEach((item) => type.add(item))
    resource.language.forEach((item) => language.add(item))
    resource.platform.forEach((item) => platform.add(item))
  }

  return {
    type: Array.from(type),
    language: Array.from(language),
    platform: Array.from(platform)
  }
}

const run = async () => {
  let cursor = 0
  let scanned = 0
  let changed = 0
  const changedUniqueIds: string[] = []

  for (;;) {
    const patches = await prisma.patch.findMany({
      where: { id: { gt: cursor } },
      orderBy: { id: 'asc' },
      take: batchSize,
      select: {
        id: true,
        unique_id: true,
        name: true,
        type: true,
        language: true,
        platform: true,
        resource: {
          where: { status: 0 },
          select: {
            type: true,
            language: true,
            platform: true
          }
        }
      }
    })

    if (!patches.length) break

    for (const patch of patches) {
      cursor = patch.id
      scanned += 1

      const next = buildAttributes(patch.resource)
      const isChanged =
        !sameSet(patch.type, next.type) ||
        !sameSet(patch.language, next.language) ||
        !sameSet(patch.platform, next.platform)

      if (!isChanged) continue

      changed += 1
      changedUniqueIds.push(patch.unique_id)
      console.log(
        `${shouldApply ? 'Updating' : 'Would update'} #${patch.id} ${patch.name}`
      )

      if (shouldApply) {
        await prisma.patch.update({
          where: { id: patch.id },
          data: {
            type: next.type,
            language: next.language,
            platform: next.platform
          }
        })
      }
    }
  }

  if (shouldApply && changed > 0) {
    const { invalidatePatchContentCache, invalidatePatchListCaches } =
      await import('../app/api/patch/cache')
    const { redis } = await import('../lib/redis')

    try {
      await Promise.all(
        changedUniqueIds.map((uniqueId) =>
          invalidatePatchContentCache(uniqueId)
        )
      )
      await invalidatePatchListCaches()
    } finally {
      redis.disconnect()
    }
  }

  console.log(
    `${shouldApply ? 'Updated' : 'Dry run found'} ${changed} changed patches out of ${scanned} scanned.`
  )
}

run()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
