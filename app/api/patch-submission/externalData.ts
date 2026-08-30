import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '~/prisma/index'
import { PATCH_SUBMISSION_EDITABLE_STATUSES } from '~/constants/patchSubmission'
import { fetchVndbDetailsData } from '~/app/api/edit/vndb/details/service'
import { fetchBangumiDetailsData } from '~/app/api/edit/bangumi/service'
import { fetchSteamDetailsData } from '~/app/api/edit/steam/service'
import { fetchDlsiteData } from '~/app/api/edit/dlsite'
import {
  companyCandidateSnapshotSchema,
  mergeCompanyCandidateSnapshot
} from '~/app/api/company/identity/types'
import { PatchSubmissionError } from './quota'
import type {
  CompanyCandidate,
  CompanyCandidateSnapshot,
  CompanyCandidateSource,
  CompanyEntityType,
  CompanyRole
} from '~/app/api/company/identity/types'
import type {
  BangumiDetailsResponse,
  DlsiteDetailsResponse,
  SteamDetailsResponse,
  VndbDetailsResponse
} from '~/types/api/externalCompanyData'

const vndbRequestSchema = z.object({
  source: z.literal('vndb'),
  lookupId: z
    .string()
    .trim()
    .regex(/^v\d+$/i, 'VNDB ID 格式不正确')
    .transform((value) => value.toLowerCase())
})

const numericRequestSchema = (source: 'bangumi' | 'steam') =>
  z.object({
    source: z.literal(source),
    lookupId: z.string().trim().regex(/^\d+$/, `${source} ID 格式不正确`)
  })

const dlsiteRequestSchema = z.object({
  source: z.literal('dlsite'),
  lookupId: z
    .string()
    .trim()
    .regex(/^(RJ|VJ|BJ)\d+$/i, 'DLSite Code 格式不正确')
    .transform((value) => value.toUpperCase())
})

export const patchSubmissionExternalDataSchema = z.discriminatedUnion(
  'source',
  [
    vndbRequestSchema,
    numericRequestSchema('bangumi'),
    numericRequestSchema('steam'),
    dlsiteRequestSchema
  ]
)

export type PatchSubmissionExternalDataInput = z.infer<
  typeof patchSubmissionExternalDataSchema
>

type ExternalDataResponse =
  | VndbDetailsResponse
  | BangumiDetailsResponse
  | SteamDetailsResponse
  | DlsiteDetailsResponse

const uniqueStrings = (values: Array<string | null | undefined>) => [
  ...new Set(values.map((value) => value?.trim()).filter(Boolean) as string[])
]

const validSourceUrls = (values: Array<string | null | undefined>) =>
  uniqueStrings(values).filter((value) => {
    try {
      new URL(value)
      return true
    } catch {
      return false
    }
  })

const vndbEntityType = (type?: string | null): CompanyEntityType => {
  if (type === 'co') return 'company'
  if (type === 'in') return 'individual'
  if (type === 'ng') return 'amateur_group'
  return 'unknown'
}

const toVndbCandidates = (data: VndbDetailsResponse): CompanyCandidate[] =>
  data.producers.map((producer) => {
    const sourceWebsites = validSourceUrls(
      producer.extlinks?.map((link) => link.url) ?? []
    )
    return {
      source: 'vndb',
      externalId: producer.id?.trim() ?? '',
      name: producer.name?.trim() ?? '',
      aliases: uniqueStrings([
        producer.original,
        ...(producer.aliases ?? [])
      ]).filter((alias) => alias !== producer.name?.trim()),
      roles: ['developer'],
      sourceRoles: ['developer'],
      entityType: vndbEntityType(producer.type),
      externalUrls: sourceWebsites,
      primaryLanguage: producer.lang?.trim() ?? '',
      sourceWebsites
    }
  })

const bangumiRole = (sourceRole: string): CompanyRole => {
  if (['开发', '游戏开发商', '开发商'].includes(sourceRole)) {
    return 'developer'
  }
  if (['发行', '发行商'].includes(sourceRole)) return 'publisher'
  return 'unknown'
}

const toBangumiCandidates = (
  data: BangumiDetailsResponse
): CompanyCandidate[] => {
  const byName = new Map<
    string,
    { roles: Set<CompanyRole>; sourceRoles: Set<string> }
  >()
  for (const reference of data.companyReferences) {
    const name = reference.name.trim()
    if (!name) continue
    const current = byName.get(name) ?? {
      roles: new Set<CompanyRole>(),
      sourceRoles: new Set<string>()
    }
    current.roles.add(bangumiRole(reference.sourceRole))
    current.sourceRoles.add(reference.sourceRole)
    byName.set(name, current)
  }

  return [...byName.entries()].map(([name, evidence]) => ({
    source: 'bangumi',
    externalId: '',
    name,
    aliases: [],
    roles: [...evidence.roles],
    sourceRoles: [...evidence.sourceRoles],
    entityType: 'unknown',
    externalUrls: [],
    primaryLanguage: '',
    sourceWebsites: []
  }))
}

const toSteamCandidates = (data: SteamDetailsResponse): CompanyCandidate[] =>
  data.developers.map((developer) => {
    const links = validSourceUrls([developer.link])
    return {
      source: 'steam',
      externalId: '',
      name: developer.name.trim(),
      aliases: [],
      roles: ['developer'],
      sourceRoles: ['developer'],
      entityType: 'unknown',
      externalUrls: links,
      primaryLanguage: '',
      sourceWebsites: links
    }
  })

const toDlsiteCandidates = (data: DlsiteDetailsResponse): CompanyCandidate[] =>
  data.circle_name?.trim()
    ? [
        {
          source: 'dlsite',
          externalId: '',
          name: data.circle_name.trim(),
          aliases: [],
          roles: ['circle'],
          sourceRoles: ['circle'],
          entityType: 'amateur_group',
          externalUrls: validSourceUrls([data.circle_link]),
          primaryLanguage: 'ja',
          sourceWebsites: validSourceUrls([data.circle_link])
        }
      ]
    : []

export const assertCanFetchPatchSubmissionExternalData = async (
  submissionId: number,
  userId: number
): Promise<string | null> => {
  const submission = await prisma.patch_submission.findFirst({
    where: { id: submissionId, user_id: userId },
    select: { status: true }
  })
  if (!submission) return '投稿不存在'
  if (
    !PATCH_SUBMISSION_EDITABLE_STATUSES.includes(
      submission.status as (typeof PATCH_SUBMISSION_EDITABLE_STATUSES)[number]
    )
  ) {
    return submission.status === 'pending'
      ? '投稿正在审核中, 无法获取外部数据。如需修改请先撤回'
      : '当前状态的投稿无法编辑'
  }
  return null
}

export const fetchPatchSubmissionExternalData = async (
  input: PatchSubmissionExternalDataInput
): Promise<{ data: ExternalDataResponse; candidates: CompanyCandidate[] }> => {
  if (input.source === 'vndb') {
    const data = await fetchVndbDetailsData(input.lookupId)
    return { data, candidates: toVndbCandidates(data) }
  }
  if (input.source === 'bangumi') {
    const data = await fetchBangumiDetailsData(input.lookupId)
    return { data, candidates: toBangumiCandidates(data) }
  }
  if (input.source === 'steam') {
    const data = await fetchSteamDetailsData(input.lookupId)
    return { data, candidates: toSteamCandidates(data) }
  }

  const data = await fetchDlsiteData(input.lookupId)
  return { data, candidates: toDlsiteCandidates(data) }
}

type LockedSubmission = {
  id: number
  user_id: number
  status: string
  company_candidates: Prisma.JsonValue | null
}

export const savePatchSubmissionCompanyCandidateSnapshot = async (input: {
  submissionId: number
  userId: number
  source: CompanyCandidateSource
  lookupId: string
  candidates: CompanyCandidate[]
  fetchedAt?: Date
}) => {
  const snapshotResult = companyCandidateSnapshotSchema.safeParse({
    lookupId: input.lookupId,
    fetchedAt: (input.fetchedAt ?? new Date()).toISOString(),
    candidates: input.candidates
  })
  if (
    !snapshotResult.success ||
    snapshotResult.data.candidates.some(
      (candidate) => candidate.source !== input.source
    )
  ) {
    throw new PatchSubmissionError('外部会社数据不符合存储规则')
  }

  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<LockedSubmission[]>(
      Prisma.sql`
        SELECT id, user_id, status, company_candidates
        FROM patch_submission
        WHERE id = ${input.submissionId}
        FOR UPDATE
      `
    )
    const submission = rows[0]
    if (!submission || submission.user_id !== input.userId) {
      throw new PatchSubmissionError('投稿不存在')
    }
    if (
      !PATCH_SUBMISSION_EDITABLE_STATUSES.includes(
        submission.status as (typeof PATCH_SUBMISSION_EDITABLE_STATUSES)[number]
      )
    ) {
      throw new PatchSubmissionError(
        submission.status === 'pending'
          ? '投稿已在抓取期间提交审核, 本次外部数据未保存'
          : '当前状态的投稿无法编辑'
      )
    }

    const merged = mergeCompanyCandidateSnapshot(
      submission.company_candidates,
      input.source,
      snapshotResult.data
    )
    await tx.patch_submission.update({
      where: { id: input.submissionId },
      data: {
        company_candidates: merged as Prisma.InputJsonObject
      }
    })
    return snapshotResult.data
  })
}

export const fetchAndSavePatchSubmissionExternalData = async (input: {
  submissionId: number
  userId: number
  request: PatchSubmissionExternalDataInput
}) => {
  const fetched = await fetchPatchSubmissionExternalData(input.request)
  await savePatchSubmissionCompanyCandidateSnapshot({
    submissionId: input.submissionId,
    userId: input.userId,
    source: input.request.source,
    lookupId: input.request.lookupId,
    candidates: fetched.candidates
  })
  return fetched.data
}
