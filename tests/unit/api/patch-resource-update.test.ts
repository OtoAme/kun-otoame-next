import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMocks = vi.hoisted(() => {
  const tx = {
    patch_resource: {
      update: vi.fn()
    }
  }

  return {
    patch_resource: {
      findUnique: vi.fn()
    },
    patch: {
      findUnique: vi.fn(),
      update: vi.fn()
    },
    $transaction: vi.fn((fn: (txClient: typeof tx) => Promise<unknown>) =>
      fn(tx)
    ),
    _tx: tx
  }
})

vi.mock('~/prisma/index', () => ({
  prisma: prismaMocks
}))

const helperMocks = vi.hoisted(() => ({
  cleanupUploadedResourceDirs: vi.fn(),
  compensateUploadedResources: vi.fn(),
  deletePatchResourceCache: vi.fn(),
  deletePatchResourceLink: vi.fn(),
  finalizeUploadedResources: vi.fn(),
  releaseUploadedResourceLocks: vi.fn(),
  uploadPatchResource: vi.fn(),
  updatePatchAttributes: vi.fn()
}))

vi.mock('~/app/api/patch/resource/_helper', () => helperMocks)

vi.mock('~/utils/resourceLink', () => ({
  parseResourceLink: (content: string) => ({ url: content, code: '' })
}))

import { updatePatchResource } from '~/app/api/patch/resource/update'

const updateInput = {
  resourceId: 10,
  patchId: 99,
  section: 'galgame' as const,
  name: '资源名',
  links: [
    {
      id: 30,
      storage: 'user',
      hash: '',
      content: 'https://example.com/resource',
      size: '1 GB',
      code: '',
      password: ''
    }
  ],
  note: '',
  type: ['game'],
  language: ['ja'],
  platform: ['windows']
}

describe('patch resource update', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMocks.patch_resource.findUnique.mockResolvedValue({
      id: 10,
      user_id: 3,
      patch_id: 20,
      links: [
        {
          id: 30,
          storage: 'user',
          content: 'https://example.com/old-resource',
          code: '',
          password: '',
          hash: '',
          size: '1 GB',
          sort_order: 0,
          download: 0
        }
      ]
    })
    prismaMocks.patch.findUnique.mockResolvedValue({
      name: '另一个游戏',
      type: [],
      language: [],
      platform: []
    })
    prismaMocks._tx.patch_resource.update.mockResolvedValue({
      id: 10,
      name: '资源名',
      section: 'galgame',
      type: ['game'],
      language: ['ja'],
      note: '',
      platform: ['windows'],
      download: 0,
      status: 0,
      user_id: 3,
      patch_id: 20,
      created: new Date('2026-06-28T00:00:00.000Z'),
      user: {
        id: 3,
        name: '资源作者',
        avatar: '',
        role: 3,
        _count: {
          patch_resource: 1
        }
      },
      patch: {
        unique_id: 'old12345'
      },
      links: [
        {
          id: 31,
          storage: 'user',
          content: 'https://example.com/resource',
          code: '',
          password: '',
          hash: '',
          size: '1 GB',
          sort_order: 0,
          download: 0
        }
      ]
    })
    helperMocks.updatePatchAttributes.mockResolvedValue('abc12345')
  })

  it('rejects updates when the submitted patch id does not own the resource', async () => {
    const result = await updatePatchResource(updateInput, 3, 3)

    expect(result).toBe('资源不属于该 OtomeGame')
    expect(prismaMocks.patch.findUnique).not.toHaveBeenCalled()
    expect(prismaMocks.$transaction).not.toHaveBeenCalled()
    expect(helperMocks.updatePatchAttributes).not.toHaveBeenCalled()
  })
})
