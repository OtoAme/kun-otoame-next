import { Prisma } from '@prisma/client'
import { prisma } from '~/prisma/index'
import { invalidateCompanyCaches } from '~/app/api/patch/cache'
import { handleBatchPatchTags } from './batchTag'
import { addPatchCompanyRelations } from './companyRelationHelper'

interface SubmittedExternalData {
  vndbTags: string[]
  vndbDevelopers: string[]
  bangumiTags: string[]
  bangumiDevelopers: string[]
  steamTags: string[]
  steamDevelopers: string[]
  steamAliases: string[]
  dlsiteCircleName: string
  dlsiteCircleLink: string
}

const ensureTagsWithSource = async (
  patchId: number,
  tagNames: string[],
  source: string,
  uid: number
) => {
  const validTags = tagNames.filter(Boolean)
  if (!validTags.length) return

  const existingTags = await prisma.patch_tag.findMany({
    where: { name: { in: validTags } },
    select: { id: true, name: true }
  })
  const existingNameSet = new Set(existingTags.map((tag) => tag.name))

  const tagsToCreate = validTags.filter((name) => !existingNameSet.has(name))
  if (tagsToCreate.length) {
    await prisma.patch_tag.createMany({
      data: tagsToCreate.map((name) => ({ name, user_id: uid, source })),
      skipDuplicates: true
    })
  }

  const allTags = await prisma.patch_tag.findMany({
    where: { name: { in: validTags } },
    select: { id: true }
  })
  const tagIds = allTags.map((tag) => tag.id)

  if (!tagIds.length) return

  const existingRelations = await prisma.patch_tag_relation.findMany({
    where: { patch_id: patchId, tag_id: { in: tagIds } },
    select: { tag_id: true }
  })
  const existingRelationIds = new Set(
    existingRelations.map((relation) => relation.tag_id)
  )
  const newTagIds = tagIds.filter((id) => !existingRelationIds.has(id))

  if (newTagIds.length) {
    await prisma.patch_tag_relation.createMany({
      data: newTagIds.map((tagId) => ({ patch_id: patchId, tag_id: tagId })),
      skipDuplicates: true
    })
    await prisma.patch_tag.updateMany({
      where: { id: { in: newTagIds } },
      data: { count: { increment: 1 } }
    })
  }
}

const toCompanyCreate = (
  name: string,
  uid: number,
  officialWebsite: string[] = []
): Prisma.patch_companyCreateManyInput => ({
  name,
  introduction: '',
  count: 0,
  primary_language: [],
  official_website: officialWebsite,
  parent_brand: [],
  alias: [],
  user_id: uid
})

const collectSubmittedCompanyNames = (data: SubmittedExternalData) => [
  ...data.vndbDevelopers,
  ...data.bangumiDevelopers,
  ...data.steamDevelopers,
  data.dlsiteCircleName
]

const ensureSubmittedCompanies = async (
  patchId: number,
  data: SubmittedExternalData,
  uid: number
) => {
  const companiesByName = new Map<string, Prisma.patch_companyCreateManyInput>()

  for (const rawName of [
    ...data.vndbDevelopers,
    ...data.bangumiDevelopers,
    ...data.steamDevelopers
  ]) {
    const name = rawName.trim()
    if (!name || companiesByName.has(name)) continue
    companiesByName.set(name, toCompanyCreate(name, uid))
  }

  const dlsiteName = data.dlsiteCircleName.trim()
  if (dlsiteName) {
    const dlsiteLink = data.dlsiteCircleLink.trim()
    companiesByName.set(
      dlsiteName,
      toCompanyCreate(dlsiteName, uid, dlsiteLink ? [dlsiteLink] : [])
    )
  }

  const companyNames = Array.from(companiesByName.keys())
  if (!companyNames.length) return []

  return await prisma.$transaction(
    async (tx) => {
      const existing = await tx.patch_company.findMany({
        where: { name: { in: companyNames } },
        select: { name: true }
      })
      const existingNames = new Set(existing.map((company) => company.name))
      const toCreate = companyNames
        .filter((name) => !existingNames.has(name))
        .map((name) => companiesByName.get(name)!)

      if (toCreate.length) {
        await tx.patch_company.createMany({
          data: toCreate,
          skipDuplicates: true
        })
      }

      const allCompanies = await tx.patch_company.findMany({
        where: { name: { in: companyNames } },
        select: { id: true }
      })
      const companyIds = allCompanies.map((company) => company.id)

      return await addPatchCompanyRelations(tx, patchId, companyIds)
    },
    { timeout: 60000 }
  )
}

const ensureAliases = async (patchId: number, aliases: string[]) => {
  const validAliases = aliases.filter(Boolean)
  if (!validAliases.length) return

  const existing = await prisma.patch_alias.findMany({
    where: { patch_id: patchId },
    select: { name: true }
  })
  const existingNames = new Set(existing.map((alias) => alias.name))
  const toCreate = validAliases.filter((name) => !existingNames.has(name))

  if (toCreate.length) {
    await prisma.patch_alias.createMany({
      data: toCreate.map((name) => ({ name, patch_id: patchId })),
      skipDuplicates: true
    })
  }
}

export const processSubmittedExternalData = async (
  patchId: number,
  data: SubmittedExternalData,
  userTags: string[],
  uid: number
) => {
  if (userTags.length) {
    await handleBatchPatchTags(patchId, userTags, uid)
  }

  const tagTasks = [
    data.vndbTags.length &&
      ensureTagsWithSource(patchId, data.vndbTags, 'vndb', uid),
    data.bangumiTags.length &&
      ensureTagsWithSource(patchId, data.bangumiTags, 'bangumi', uid),
    data.steamTags.length &&
      ensureTagsWithSource(patchId, data.steamTags, 'steam', uid)
  ].filter(Boolean)

  const companyTask = ensureSubmittedCompanies(patchId, data, uid)
    .then(async (insertedIds) => {
      if (insertedIds.length) {
        await invalidateCompanyCaches()
      }
      return insertedIds
    })
    .catch((error) => {
      console.error('Failed to process external company relations', {
        patchId,
        source: 'company_relation',
        names: collectSubmittedCompanyNames(data).filter(Boolean),
        error
      })
      throw error
    })

  const aliasTasks = [
    data.steamAliases.length && ensureAliases(patchId, data.steamAliases)
  ].filter(Boolean)

  await Promise.allSettled([...tagTasks, companyTask, ...aliasTasks])
}
