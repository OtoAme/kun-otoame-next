import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ensureCompanyRelationsByNameMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/edit/companyEnsureHelper', () => ({
  ensureCompanyRelationsByName: ensureCompanyRelationsByNameMock,
  uniqueTrimmed: (values: string[]) => [
    ...new Set(values.map((value) => value.trim()).filter(Boolean))
  ]
}))

const applyCompanyResolutionMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/company/identity/resolver', () => ({
  applyCompanyResolution: applyCompanyResolutionMock
}))
vi.mock('~/app/api/patch/cache', () => ({
  invalidateCompanyCaches: vi.fn(),
  invalidatePatchListCaches: vi.fn()
}))
vi.mock('~/app/api/edit/_postToIndexNow', () => ({
  postToIndexNow: vi.fn()
}))

import { publishSubmissionCore } from '~/app/api/patch-submission/publishCore'
import type { PatchSubmissionPayload } from '~/types/api/patchSubmission'

const payload: PatchSubmissionPayload = {
  name: 'Game',
  introduction: 'Introduction',
  vndbId: '',
  vndbRelationId: '',
  bangumiId: '',
  steamId: '',
  dlsiteCode: '',
  dlsiteCircleName: '',
  dlsiteCircleLink: '',
  vndbTags: [],
  vndbDevelopers: ['Legacy Studio'],
  bangumiTags: [],
  bangumiDevelopers: [],
  steamTags: [],
  steamDevelopers: [],
  steamAliases: [],
  officialUrl: '',
  alias: [],
  tag: [],
  released: '2026-08-30',
  contentLimit: 'sfw',
  isDuplicate: false
}

const tx = {
  patch: { create: vi.fn() },
  patch_rating_stat: { create: vi.fn() },
  patch_alias: { createMany: vi.fn() },
  patch_tag: {
    findMany: vi.fn(),
    createMany: vi.fn(),
    updateMany: vi.fn()
  },
  patch_tag_relation: { createMany: vi.fn() },
  patch_game_image: { createMany: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.KUN_COMPANY_IDENTITY_RESOLVER_ENABLED
  tx.patch.create.mockResolvedValue({ id: 5, unique_id: 'abcd1234' })
  tx.patch_rating_stat.create.mockResolvedValue({})
  ensureCompanyRelationsByNameMock.mockResolvedValue({
    ensured: 1,
    related: 1,
    insertedIds: [7]
  })
  applyCompanyResolutionMock.mockResolvedValue({
    companyIds: [7],
    created: 0,
    insertedRelationIds: [7],
    diagnostics: []
  })
})

afterEach(() => {
  delete process.env.KUN_COMPANY_IDENTITY_RESOLVER_ENABLED
})

describe('submission publish company branch', () => {
  it('keeps the exact-name publisher when the server flag is off', async () => {
    await publishSubmissionCore(tx as never, {
      authorId: 100,
      payload,
      bannerKey: null,
      gallery: []
    })

    expect(ensureCompanyRelationsByNameMock).toHaveBeenCalledOnce()
    expect(applyCompanyResolutionMock).not.toHaveBeenCalled()
  })

  it('uses the same resolver branch as preview when the server flag is on', async () => {
    process.env.KUN_COMPANY_IDENTITY_RESOLVER_ENABLED = 'true'
    const candidates = [
      {
        trust: 'unverified' as const,
        candidate: {
          source: 'steam' as const,
          externalId: '',
          name: 'Legacy Studio',
          aliases: [],
          roles: ['developer' as const],
          sourceRoles: [],
          entityType: 'unknown' as const,
          externalUrls: [],
          primaryLanguage: '',
          sourceWebsites: []
        }
      }
    ]

    const result = await publishSubmissionCore(tx as never, {
      authorId: 100,
      payload,
      bannerKey: null,
      gallery: [],
      companyCandidates: candidates
    })

    expect(applyCompanyResolutionMock).toHaveBeenCalledWith(
      tx,
      5,
      candidates,
      100
    )
    expect(ensureCompanyRelationsByNameMock).not.toHaveBeenCalled()
    expect(result.touchedCompanies).toBe(true)
  })
})
