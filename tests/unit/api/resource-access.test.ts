import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const prismaMocks = vi.hoisted(() => ({
  patch_resource: {
    findMany: vi.fn()
  },
  patch_resource_link: {
    findFirst: vi.fn()
  }
}))

vi.mock('~/prisma/index', () => ({
  prisma: prismaMocks
}))

vi.mock('~/app/api/utils/getPatchVisibilityWhere', () => ({
  getPatchVisibilityWhere: vi.fn().mockResolvedValue({ content_limit: 'sfw' })
}))

const jsonRequest = (body: unknown) =>
  new NextRequest('https://www.otoame.top/api/patch/resource/download/access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })

describe('resource download access Phase 1 API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('omits content, code, and password from resource list links while keeping hash', async () => {
    const { getPatchResource } = await import('~/app/api/patch/resource/get')

    prismaMocks.patch_resource.findMany.mockResolvedValueOnce([
      {
        id: 11,
        name: 'Main resource',
        section: 'galgame',
        type: ['game'],
        language: ['zh'],
        note: '',
        platform: ['windows'],
        download: 0,
        status: 0,
        user_id: 3,
        patch_id: 7,
        created: new Date('2026-07-06T00:00:00.000Z'),
        patch: { unique_id: 'ABCDEFGH' },
        user: {
          id: 3,
          name: 'Saya',
          avatar: '',
          role: 2,
          _count: { patch_resource: 1 }
        },
        links: [
          {
            id: 21,
            storage: 's3',
            size: '1 GB',
            code: 'secret-code',
            password: 'secret-password',
            hash: 'hash-value',
            content: 'https://example.com/file',
            sort_order: 1,
            download: 5
          }
        ],
        _count: { like_by: 0 },
        like_by: []
      }
    ])

    const resources = await getPatchResource({ patchId: 7 }, 0)

    expect(resources[0].links[0]).toEqual({
      id: 21,
      storage: 's3',
      size: '1 GB',
      hash: 'hash-value',
      sortOrder: 1,
      download: 5
    })
  })

  it('returns one sensitive link from access API with private no-store cache header', async () => {
    const { POST } = await import(
      '~/app/api/patch/resource/download/access/route'
    )

    prismaMocks.patch_resource_link.findFirst.mockResolvedValueOnce({
      id: 21,
      storage: 'user',
      size: '2 GB',
      content: 'https://pan.example.com/share',
      code: 'abcd',
      password: 'pass',
      hash: ''
    })

    const response = await POST(
      jsonRequest({ patchId: 7, resourceId: 11, linkId: 21 })
    )

    await expect(response.json()).resolves.toEqual({
      link: {
        id: 21,
        storage: 'user',
        size: '2 GB',
        content: 'https://pan.example.com/share',
        code: 'abcd',
        password: 'pass',
        hash: ''
      }
    })
    expect(prismaMocks.patch_resource_link.findFirst).toHaveBeenCalledWith({
      where: {
        id: 21,
        resource_id: 11,
        resource: {
          id: 11,
          patch_id: 7,
          status: 0,
          patch: {
            id: 7,
            status: 0,
            content_limit: 'sfw'
          }
        }
      },
      select: {
        id: true,
        storage: true,
        size: true,
        content: true,
        code: true,
        password: true,
        hash: true
      }
    })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })
})
