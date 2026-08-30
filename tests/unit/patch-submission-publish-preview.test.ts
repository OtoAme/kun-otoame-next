import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildPatchSubmissionPublishPreview,
  projectPatchSubmissionPayload
} from '~/app/api/patch-submission/publishPreview'
import type { PatchSubmissionPayload } from '~/types/api/patchSubmission'

const payload: PatchSubmissionPayload = {
  name: 'Preview game',
  introduction: '# Heading\n\nA **strong** description.',
  vndbId: 'v1',
  vndbRelationId: 'r2',
  bangumiId: '3',
  steamId: '4',
  dlsiteCode: 'RJ5',
  dlsiteCircleName: ' Circle ',
  dlsiteCircleLink: 'https://example.test/circle',
  vndbTags: ['Drama', ' Shared '],
  vndbDevelopers: ['Studio A'],
  bangumiTags: ['Shared', 'Comedy'],
  bangumiDevelopers: ['Studio A'],
  steamTags: ['Drama'],
  steamDevelopers: ['Studio B'],
  steamAliases: ['Alt', 'Shared alias'],
  officialUrl: '',
  alias: [' Main alias ', 'Alt'],
  tag: ['Manual', 'Drama'],
  released: '',
  contentLimit: 'nsfw',
  isDuplicate: false
}

beforeEach(() => {
  process.env.KUN_VISUAL_NOVEL_IMAGE_BED_URL = 'https://img.example.test/'
  delete process.env.KUN_COMPANY_IDENTITY_RESOLVER_ENABLED
})

afterEach(() => {
  delete process.env.KUN_COMPANY_IDENTITY_RESOLVER_ENABLED
})

describe('patch submission publish projection', () => {
  it('merges aliases, tags and companies exactly once for preview and publish', () => {
    expect(projectPatchSubmissionPayload(payload)).toEqual({
      name: 'Preview game',
      introduction: payload.introduction,
      aliases: ['Main alias', 'Alt', 'Shared alias'],
      tagNames: ['Manual', 'Drama', 'Shared', 'Comedy'],
      companyNames: ['Studio A', 'Studio B', 'Circle'],
      officialUrl: 'https://store.steampowered.com/app/4',
      released: 'unknown',
      contentLimit: 'nsfw'
    })
  })

  it('renders markdown and projects the exact published asset URLs', async () => {
    const preview = await buildPatchSubmissionPublishPreview({
      payload,
      bannerKey: 'patch-submission/1/banner/banner.avif',
      bannerOriginalKey: 'patch-submission/1/banner/banner-original.avif',
      gallery: [
        {
          id: 9,
          key: 'patch-submission/1/gallery/9.avif',
          thumbnailKey: 'patch-submission/1/gallery/thumb-9.avif',
          isNSFW: true,
          displayOrder: 2
        }
      ]
    })

    expect(preview.introductionHtml).toContain('<h1>Heading</h1>')
    expect(preview.introductionHtml).toContain('<strong>strong</strong>')
    expect(preview.bannerUrl).toBe(
      'https://img.example.test/patch-submission/1/banner/banner.avif'
    )
    expect(preview.bannerOriginalUrl).toBe(
      'https://img.example.test/patch-submission/1/banner/banner-original.avif'
    )
    expect(preview.gallery).toEqual([
      {
        id: 9,
        imageUrl: 'https://img.example.test/patch-submission/1/gallery/9.avif',
        thumbnailUrl:
          'https://img.example.test/patch-submission/1/gallery/thumb-9.avif',
        isNSFW: true,
        displayOrder: 2
      }
    ])
  })

  it('switches to canonical company names without leaking diagnostics to the author', async () => {
    process.env.KUN_COMPANY_IDENTITY_RESOLVER_ENABLED = 'true'
    const resolutionDb = {
      patch_company: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: 7, name: 'Palette', normalized_name: 'studio a' }
          ])
      },
      patch_company_name_identity: {
        findMany: vi.fn().mockResolvedValue([])
      },
      patch_company_external_id: {
        findMany: vi.fn().mockResolvedValue([])
      }
    }

    const preview = await buildPatchSubmissionPublishPreview({
      payload: {
        ...payload,
        vndbDevelopers: ['ＳＴＵＤＩＯ　Ａ'],
        bangumiDevelopers: [],
        steamDevelopers: [],
        dlsiteCircleName: ''
      },
      bannerKey: null,
      bannerOriginalKey: null,
      gallery: [],
      resolutionDb: resolutionDb as never
    })

    expect(preview.companyNames).toEqual(['Palette'])
    expect(preview).not.toHaveProperty('companyDiagnostics')
    expect(preview.companyNeedsReview).toBe(false)
  })

  it('includes resolver details only when the administrator service asks for them', async () => {
    process.env.KUN_COMPANY_IDENTITY_RESOLVER_ENABLED = 'true'
    const resolutionDb = {
      patch_company: { findMany: vi.fn().mockResolvedValue([]) },
      patch_company_name_identity: {
        findMany: vi.fn().mockResolvedValue([])
      },
      patch_company_external_id: {
        findMany: vi.fn().mockResolvedValue([])
      }
    }

    const preview = await buildPatchSubmissionPublishPreview({
      payload,
      bannerKey: null,
      bannerOriginalKey: null,
      gallery: [],
      includeDiagnostics: true,
      resolutionDb: resolutionDb as never
    })

    expect(preview.companyDiagnostics).toBeDefined()
    expect(preview.companyDiagnostics?.wouldCreate.length).toBeGreaterThan(0)
  })
})
