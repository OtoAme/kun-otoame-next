import { describe, expect, it, vi } from 'vitest'
import type { PatchResource } from '~/types/api/patch'

const resource: PatchResource = {
  id: 11,
  name: '测试资源',
  section: 'galgame',
  uniqueId: 'ABCDEFGH',
  type: ['game'],
  language: ['zh'],
  platform: ['windows'],
  note: '',
  links: [
    {
      id: 21,
      storage: 'user',
      size: '2 GB',
      hash: '',
      sortOrder: 7,
      download: 9
    }
  ],
  likeCount: 0,
  download: 0,
  isLike: false,
  status: 0,
  userId: 3,
  patchId: 7,
  created: '2026-07-06T00:00:00.000Z',
  user: {
    id: 3,
    name: 'Saya',
    avatar: '',
    patchCount: 1,
    role: 2
  }
}

describe('accessResourceLinksForEdit', () => {
  it('hydrates preview links before opening the edit form', async () => {
    const { accessResourceLinksForEdit } = await import(
      '~/components/patch/resource/accessResourceLinksForEdit'
    )
    const fetcher = vi.fn().mockResolvedValueOnce({
      link: {
        id: 21,
        storage: 'user',
        size: '2 GB',
        content: 'https://pan.example.com/share',
        code: 'abcd',
        password: 'secret',
        hash: ''
      }
    })

    const result = await accessResourceLinksForEdit(resource, fetcher)

    expect(fetcher).toHaveBeenCalledWith('/patch/resource/download/access', {
      patchId: 7,
      resourceId: 11,
      linkId: 21
    })
    expect(result).toEqual({
      ...resource,
      links: [
        {
          id: 21,
          storage: 'user',
          size: '2 GB',
          content: 'https://pan.example.com/share',
          code: 'abcd',
          password: 'secret',
          hash: '',
          sortOrder: 7,
          download: 9
        }
      ]
    })
  })

  it('returns a business error string when a link cannot be hydrated', async () => {
    const { accessResourceLinksForEdit } = await import(
      '~/components/patch/resource/accessResourceLinksForEdit'
    )
    const fetcher = vi.fn().mockResolvedValueOnce('该资源不可访问')

    await expect(accessResourceLinksForEdit(resource, fetcher)).resolves.toBe(
      '该资源不可访问'
    )
  })
})
