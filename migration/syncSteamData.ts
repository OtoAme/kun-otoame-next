import 'dotenv/config'
import { prisma } from '~/prisma/index'
import { fetchSteamAppData } from '~/lib/arnebiae/steam'
import { lowQualitySteamTags } from '~/lib/steamDirtyTag'
import { normalizeStringArray } from '~/utils/normalizeStringArray'
import {
  buildTagLookupWhere,
  getCanonicalTagIds,
  hasAnyTagName,
  mapTagNamesToIds
} from '~/app/api/edit/tagEnsureHelper'
import type { SteamAppData } from '~/lib/arnebiae/steam'

const CONCURRENCY = 2
const SYSTEM_USER_ID = 1
const dirtyTagSet = new Set(
  lowQualitySteamTags.map((tag) => tag.trim()).filter(Boolean)
)

async function processTags(patchId: number, data: SteamAppData, uid: number) {
  const filteredTags = normalizeStringArray(data.tags).filter(
    (tag) => !dirtyTagSet.has(tag)
  )
  if (!filteredTags.length) return { ensured: 0, related: 0 }

  return await prisma.$transaction(
    async (tx) => {
      const existingTags = await tx.patch_tag.findMany({
        where: buildTagLookupWhere(filteredTags),
        orderBy: { id: 'asc' },
        select: { id: true, name: true, alias: true }
      })
      const tagNameToId = mapTagNamesToIds(existingTags)

      const tagsToCreate = filteredTags.filter(
        (tag) => !tagNameToId.has(tag) && !hasAnyTagName(existingTags, tag)
      )

      if (tagsToCreate.length) {
        await tx.patch_tag.createMany({
          data: tagsToCreate.map((name) => ({
            name,
            user_id: uid,
            source: 'steam'
          })),
          skipDuplicates: true
        })
      }

      const newTags =
        tagsToCreate.length > 0
          ? await tx.patch_tag.findMany({
              where: { name: { in: tagsToCreate } },
              select: { id: true, name: true, alias: true }
            })
          : []
      for (const [name, tagId] of mapTagNamesToIds(newTags)) {
        tagNameToId.set(name, tagId)
      }

      const tagIds = getCanonicalTagIds(filteredTags, tagNameToId)

      if (tagIds.length) {
        const existingRelations = await tx.patch_tag_relation.findMany({
          where: { patch_id: patchId, tag_id: { in: tagIds } },
          select: { tag_id: true }
        })
        const existingRelationIds = new Set(
          existingRelations.map((relation) => relation.tag_id)
        )
        const newTagIds = tagIds.filter((id) => !existingRelationIds.has(id))

        if (newTagIds.length) {
          await tx.patch_tag_relation.createMany({
            data: newTagIds.map((tagId) => ({
              patch_id: patchId,
              tag_id: tagId
            })),
            skipDuplicates: true
          })

          await tx.patch_tag.updateMany({
            where: { id: { in: newTagIds } },
            data: { count: { increment: 1 } }
          })
        }
      }

      return { ensured: tagsToCreate.length, related: tagIds.length }
    },
    { timeout: 60000 }
  )
}

async function processCompanies(
  patchId: number,
  data: SteamAppData,
  uid: number
) {
  for (const dev of data.developers) {
    const devName = dev.name?.trim()
    if (!devName) continue

    let company = await prisma.patch_company.findFirst({
      where: { name: devName }
    })

    if (!company) {
      company = await prisma.patch_company.create({
        data: {
          name: devName,
          introduction: '',
          count: 0,
          primary_language: [],
          official_website: dev.link ? [dev.link] : [],
          parent_brand: [],
          alias: [],
          user_id: uid
        }
      })
    }

    const existingRelation = await prisma.patch_company_relation.findFirst({
      where: { patch_id: patchId, company_id: company.id }
    })

    if (!existingRelation) {
      await prisma.patch_company_relation.create({
        data: { patch_id: patchId, company_id: company.id }
      })

      await prisma.patch_company.update({
        where: { id: company.id },
        data: { count: { increment: 1 } }
      })
    }
  }
}

async function processAliases(patchId: number, data: SteamAppData) {
  const aliasValues = Object.values(data.aliases)
    .map((v) => v?.trim())
    .filter((v): v is string => !!v)
  const uniqueAliases = [...new Set(aliasValues)]

  if (!uniqueAliases.length) return

  const existingAliases = await prisma.patch_alias.findMany({
    where: { patch_id: patchId },
    select: { name: true }
  })
  const existingNameSet = new Set(existingAliases.map((a) => a.name))

  const toCreate = uniqueAliases.filter((name) => !existingNameSet.has(name))

  if (toCreate.length) {
    await prisma.patch_alias.createMany({
      data: toCreate.map((name) => ({ name, patch_id: patchId })),
      skipDuplicates: true
    })
  }
}

async function syncSteamData() {
  console.log('Step 1: 获取有 steam_id 的 patch...')

  const patches = await prisma.patch.findMany({
    where: { steam_id: { not: null } },
    select: {
      id: true,
      steam_id: true,
      unique_id: true,
      tag: {
        where: { tag: { source: 'steam' } },
        select: { id: true },
        take: 1
      }
    },
    orderBy: { id: 'asc' }
  })

  const patchesToSync = patches.filter((p) => p.tag.length === 0)
  const skippedCount = patches.length - patchesToSync.length

  console.log(
    `找到 ${patches.length} 个有 steam_id 的 patch，` +
      `跳过 ${skippedCount} 个已有 Steam tag 的 patch，` +
      `需同步 ${patchesToSync.length} 个`
  )

  if (!patchesToSync.length) {
    console.log('无需同步，脚本结束')
    return
  }

  let successCount = 0
  let noTagCount = 0
  let failCount = 0
  let totalEnsured = 0
  let totalRelated = 0
  let processed = 0

  const processPatch = async (patch: (typeof patchesToSync)[number]) => {
    try {
      const data = await fetchSteamAppData(patch.steam_id!)

      const tagResult = await processTags(patch.id, data, SYSTEM_USER_ID)
      await processCompanies(patch.id, data, SYSTEM_USER_ID)
      await processAliases(patch.id, data)

      if (tagResult.related > 0) {
        successCount++
        totalEnsured += tagResult.ensured
        totalRelated += tagResult.related
        processed++
        console.log(
          `[${processed}/${patchesToSync.length}] ${patch.unique_id} (steam=${patch.steam_id}): ` +
            `新建=${tagResult.ensured}, 关联=${tagResult.related}`
        )
      } else {
        noTagCount++
        processed++
      }
    } catch (error) {
      failCount++
      processed++
      console.error(
        `[${processed}/${patchesToSync.length}] ${patch.unique_id} (steam=${patch.steam_id}): 失败`,
        error
      )
    }
  }

  let currentIndex = 0
  const worker = async () => {
    while (true) {
      const index = currentIndex++
      if (index >= patchesToSync.length) break
      await processPatch(patchesToSync[index])
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

  console.log(`\n同步完成:`)
  console.log(
    `  成功: ${successCount} (新建标签 ${totalEnsured}, 关联 ${totalRelated})`
  )
  console.log(`  无匹配标签: ${noTagCount}`)
  console.log(`  失败: ${failCount}`)
  console.log(`  已跳过 (已有 Steam tag): ${skippedCount}`)
  console.log(`  总计: ${patches.length}`)
}

syncSteamData()
  .catch((error) => {
    console.error('Migration failed:', error)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
