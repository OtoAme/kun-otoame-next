import { Prisma } from '@prisma/client'
import { prisma } from '~/prisma/index'
import { invalidateCompanyCaches } from '~/app/api/patch/cache'
import { handleBatchPatchTags } from './batchTag'
import {
  ensurePatchCompaniesFromVNDB,
  fetchVndbCompanyCreateMap
} from './fetchCompanies'
import {
  ensureCompanyRelationsByName,
  uniqueTrimmed,
  type CompanyCreateInput
} from './companyEnsureHelper'
import {
  buildTagLookupWhere,
  getCanonicalTagIds,
  hasAnyTagName,
  mapTagNamesToIds
} from './tagEnsureHelper'

type TxClient = Prisma.TransactionClient

export interface SubmittedExternalData {
  vndbId?: string
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

export interface PreparedSubmittedExternalData {
  vndbCompaniesByName: Map<string, CompanyCreateInput>
  primaryDevelopers: string[]
}

export interface ProcessSubmittedExternalDataResult {
  tagCachesChanged: boolean
  companyCachesChanged: boolean
}

const ensureTagsWithSourceTx = async (
  tx: TxClient,
  patchId: number,
  tagNames: string[],
  source: string,
  uid: number
) => {
  const validTags = uniqueTrimmed(tagNames)
  if (!validTags.length) return false

  const existingTags = await tx.patch_tag.findMany({
    where: buildTagLookupWhere(validTags),
    orderBy: { id: 'asc' },
    select: { id: true, name: true, alias: true }
  })
  const tagNameToId = mapTagNamesToIds(existingTags)

  const tagsToCreate = validTags.filter(
    (name) => !tagNameToId.has(name) && !hasAnyTagName(existingTags, name)
  )
  if (tagsToCreate.length) {
    await tx.patch_tag.createMany({
      data: tagsToCreate.map((name) => ({ name, user_id: uid, source })),
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
  for (const tag of newTags) {
    tagNameToId.set(tag.name, tag.id)
    for (const alias of tag.alias) {
      tagNameToId.set(alias, tag.id)
    }
  }

  const tagIds = getCanonicalTagIds(validTags, tagNameToId)
  if (!tagIds.length) return tagsToCreate.length > 0

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

  return tagsToCreate.length > 0 || newTagIds.length > 0
}

const ensureTagsWithSource = async (
  patchId: number,
  tagNames: string[],
  source: string,
  uid: number
) => {
  await prisma.$transaction(
    (tx) => ensureTagsWithSourceTx(tx, patchId, tagNames, source, uid),
    { timeout: 60000 }
  )
}

const toCompanyCreate = (
  name: string,
  uid: number,
  officialWebsite: string[] = []
): CompanyCreateInput => ({
  name,
  introduction: '',
  count: 0,
  primary_language: [],
  official_website: officialWebsite,
  parent_brand: [],
  alias: [],
  user_id: uid
})

const collectPrimaryDeveloperNames = (data: SubmittedExternalData) => {
  const vndbDevelopers = uniqueTrimmed(data.vndbDevelopers)
  if (vndbDevelopers.length) return vndbDevelopers

  return uniqueTrimmed(data.bangumiDevelopers)
}

const collectSubmittedCompanyNames = (data: SubmittedExternalData) => [
  ...collectPrimaryDeveloperNames(data),
  ...data.steamDevelopers,
  data.dlsiteCircleName
]

const ensureSubmittedCompanies = async (
  patchId: number,
  data: SubmittedExternalData,
  uid: number,
  options: { primaryDevelopers?: string[] } = {}
) => {
  const companiesByName = new Map<string, CompanyCreateInput>()
  const primaryDevelopers =
    options.primaryDevelopers ?? collectPrimaryDeveloperNames(data)

  for (const rawName of [
    ...primaryDevelopers,
    ...uniqueTrimmed(data.steamDevelopers)
  ]) {
    const name = rawName.trim()
    if (companiesByName.has(name)) continue
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

  if (!companiesByName.size) return []

  return await prisma.$transaction(
    async (tx) => {
      const result = await ensureCompanyRelationsByName(
        tx,
        patchId,
        companiesByName
      )
      return result.insertedIds
    },
    { timeout: 60000 }
  )
}

const ensureAliasesTx = async (
  tx: TxClient,
  patchId: number,
  aliases: string[]
) => {
  const validAliases = aliases.filter(Boolean)
  if (!validAliases.length) return false

  const existing = await tx.patch_alias.findMany({
    where: { patch_id: patchId },
    select: { name: true }
  })
  const existingNames = new Set(existing.map((alias) => alias.name))
  const toCreate = validAliases.filter((name) => !existingNames.has(name))

  if (toCreate.length) {
    await tx.patch_alias.createMany({
      data: toCreate.map((name) => ({ name, patch_id: patchId })),
      skipDuplicates: true
    })
  }

  return toCreate.length > 0
}

const ensureAliases = async (patchId: number, aliases: string[]) => {
  await ensureAliasesTx(prisma, patchId, aliases)
}

const ensureSubmittedCompaniesTx = async (
  tx: TxClient,
  patchId: number,
  data: SubmittedExternalData,
  uid: number,
  primaryDevelopers: string[]
) => {
  const companiesByName = new Map<string, CompanyCreateInput>()

  for (const rawName of [
    ...primaryDevelopers,
    ...uniqueTrimmed(data.steamDevelopers)
  ]) {
    const name = rawName.trim()
    if (companiesByName.has(name)) continue
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

  if (!companiesByName.size) return []

  const result = await ensureCompanyRelationsByName(tx, patchId, companiesByName)
  return result.insertedIds
}

export const prepareSubmittedExternalDataForCreate = async (
  data: SubmittedExternalData,
  uid: number
): Promise<PreparedSubmittedExternalData> => {
  const vndbCompaniesByName = await fetchVndbCompanyCreateMap(data.vndbId, uid)

  return {
    vndbCompaniesByName,
    primaryDevelopers:
      vndbCompaniesByName.size > 0 ? [] : collectPrimaryDeveloperNames(data)
  }
}

export const processSubmittedExternalDataForCreate = async (
  tx: TxClient,
  patchId: number,
  data: SubmittedExternalData,
  userTags: string[],
  uid: number,
  prepared: PreparedSubmittedExternalData
): Promise<ProcessSubmittedExternalDataResult> => {
  let tagCachesChanged = false
  let companyCachesChanged = false

  if (userTags.length) {
    tagCachesChanged =
      (await ensureTagsWithSourceTx(tx, patchId, userTags, 'self', uid)) ||
      tagCachesChanged
  }

  tagCachesChanged =
    (await ensureTagsWithSourceTx(
      tx,
      patchId,
      data.bangumiTags,
      'bangumi',
      uid
    )) || tagCachesChanged
  tagCachesChanged =
    (await ensureTagsWithSourceTx(tx, patchId, data.steamTags, 'steam', uid)) ||
    tagCachesChanged

  if (prepared.vndbCompaniesByName.size) {
    const result = await ensureCompanyRelationsByName(
      tx,
      patchId,
      prepared.vndbCompaniesByName
    )
    companyCachesChanged = result.insertedIds.length > 0 || companyCachesChanged
  }

  const insertedCompanyIds = await ensureSubmittedCompaniesTx(
    tx,
    patchId,
    data,
    uid,
    prepared.primaryDevelopers
  )
  companyCachesChanged =
    insertedCompanyIds.length > 0 || companyCachesChanged

  await ensureAliasesTx(tx, patchId, data.steamAliases)

  return { tagCachesChanged, companyCachesChanged }
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
    data.bangumiTags.length &&
      ensureTagsWithSource(patchId, data.bangumiTags, 'bangumi', uid),
    data.steamTags.length &&
      ensureTagsWithSource(patchId, data.steamTags, 'steam', uid)
  ].filter(Boolean)

  let primaryDevelopers = collectPrimaryDeveloperNames(data)
  if (data.vndbId?.trim()) {
    const result = await ensurePatchCompaniesFromVNDB(patchId, data.vndbId, uid)
    if (result.related > 0) {
      primaryDevelopers = []
    }
  }

  const companyTask = ensureSubmittedCompanies(patchId, data, uid, {
    primaryDevelopers
  })
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

  await companyTask
  await Promise.allSettled([...tagTasks, ...aliasTasks])
}
