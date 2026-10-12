import { describe, expect, it, vi } from 'vitest'
import type { PatchResource, PatchResourceHealthLink } from '~/types/api/patch'
import { LINK_HEALTH_ERRORS } from '~/constants/linkHealth'

const healthLink = (
  overrides: Partial<PatchResourceHealthLink> = {}
): PatchResourceHealthLink => ({
  id: 21,
  storage: 'user',
  size: '2 GB',
  hash: '',
  sortOrder: 7,
  download: 9,
  version: 3,
  evidenceRound: 1,
  health: 'ok',
  healthChangedAt: null,
  verifiedAt: null,
  lastRelinkAt: null,
  ownerType: 'publisher',
  disputeSource: null,
  recentReportCount: 0,
  latestCheck: null,
  capabilities: {
    ownerActions: [],
    resolveActions: [],
    canCheck: false,
    canEdit: false
  },
  ...overrides
})

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
    healthLink({
      id: 21,
      version: 2,
      sortOrder: 7,
      download: 9
    })
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
    const { accessResourceLinksForEdit, readEditContext } = await import(
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
        hash: '',
        version: 2
      }
    })

    const result = await accessResourceLinksForEdit(resource, fetcher)

    expect(fetcher).toHaveBeenCalledWith('/patch/resource/download/access', {
      patchId: 7,
      resourceId: 11,
      linkId: 21
    })
    expect(result).toMatchObject({
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
          download: 9,
          version: 2
        }
      ]
    })
    // 打开即定的唯一基点随对象传递
    expect(
      readEditContext(result as PatchResource)?.baseLinks
    ).toEqual([{ id: 21, version: 2 }])
  })

  it('fails closed without fetching when the snapshot has no versions', async () => {
    const { accessResourceLinksForEdit } = await import(
      '~/components/patch/resource/accessResourceLinksForEdit'
    )
    const legacy: PatchResource = {
      ...resource,
      links: [
        {
          id: 21,
          storage: 'user',
          size: '2 GB',
          hash: '',
          sortOrder: 7,
          download: 9
        }
      ]
    }
    const fetcher = vi.fn()

    const result = await accessResourceLinksForEdit(legacy, fetcher)

    expect(result).toBe(LINK_HEALTH_ERRORS.resource_conflict.message)
    expect(fetcher).not.toHaveBeenCalled()
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

describe('accessResourceLinksForEdit stable base (M04-1)', () => {
  const stableResource: PatchResource = {
    ...resource,
    links: [
      healthLink({ id: 21, version: 3 }),
      healthLink({ id: 22, version: 1 })
    ]
  }

  const accessResponse = (id: number, version: number) => ({
    link: {
      id,
      storage: 'user',
      size: '2 GB',
      content: `https://pan.example.com/share-${id}`,
      code: 'abcd',
      password: 'secret',
      hash: '',
      version
    },
    access: {
      kind: 'link_revealed',
      actorType: 'user',
      cost: 0,
      obtainedExpiresAt: '2026-10-10T00:00:00.000Z'
    }
  })

  it('captures baseLinks once from the snapshot when every access version matches', async () => {
    const { accessResourceLinksForEdit, readEditContext } = await import(
      '~/components/patch/resource/accessResourceLinksForEdit'
    )
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(accessResponse(21, 3))
      .mockResolvedValueOnce(accessResponse(22, 1))

    const result = await accessResourceLinksForEdit(stableResource, fetcher)

    expect(typeof result).not.toBe('string')
    const context = readEditContext(result as PatchResource)
    expect(context?.baseLinks).toEqual([
      { id: 21, version: 3 },
      { id: 22, version: 1 }
    ])
  })

  it('rejects a mixed base when the snapshot is only partially versioned', async () => {
    const { accessResourceLinksForEdit } = await import(
      '~/components/patch/resource/accessResourceLinksForEdit'
    )
    const mixed: PatchResource = {
      ...resource,
      links: [
        healthLink({ id: 21, version: 3 }),
        {
          id: 22,
          storage: 'user',
          size: '2 GB',
          hash: '',
          sortOrder: 8,
          download: 9
        }
      ]
    }
    const fetcher = vi.fn()

    const result = await accessResourceLinksForEdit(mixed, fetcher)

    expect(result).toBe(LINK_HEALTH_ERRORS.resource_conflict.message)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects the hydration when an access version does not match the snapshot', async () => {
    const { accessResourceLinksForEdit } = await import(
      '~/components/patch/resource/accessResourceLinksForEdit'
    )
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(accessResponse(21, 4))
      .mockResolvedValueOnce(accessResponse(22, 1))

    const result = await accessResourceLinksForEdit(stableResource, fetcher)

    expect(result).toBe(LINK_HEALTH_ERRORS.version_conflict.message)
  })

  it('carries the relink focus into the edit context', async () => {
    const { accessResourceLinksForEdit, readEditContext } = await import(
      '~/components/patch/resource/accessResourceLinksForEdit'
    )
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(accessResponse(21, 3))
      .mockResolvedValueOnce(accessResponse(22, 1))

    const result = await accessResourceLinksForEdit(stableResource, fetcher, 22)

    expect(readEditContext(result as PatchResource)?.focusLinkId).toBe(22)
  })
})

describe('captureResourceEditContext (baseline priority)', () => {
  it('prefers an explicit DTO baseLinks over link versions', async () => {
    const { accessResourceLinksForEdit, readEditContext } = await import(
      '~/components/patch/resource/accessResourceLinksForEdit'
    )
    const dtoResource = {
      ...resource,
      links: [healthLink({ id: 21, version: 2 })],
      baseLinks: [{ id: 21, version: 9 }]
    } as PatchResource
    const fetcher = vi.fn().mockResolvedValueOnce({
      link: {
        id: 21,
        storage: 'user',
        size: '2 GB',
        content: 'https://pan.example.com/share',
        code: 'abcd',
        password: 'secret',
        hash: '',
        version: 9
      }
    })

    const result = await accessResourceLinksForEdit(dtoResource, fetcher)

    expect(readEditContext(result as PatchResource)?.baseLinks).toEqual([
      { id: 21, version: 9 }
    ])
  })

  it('respects an explicit empty snapshot as a legitimate baseline', async () => {
    const { accessResourceLinksForEdit, readEditContext } = await import(
      '~/components/patch/resource/accessResourceLinksForEdit'
    )
    const emptyResource: PatchResource = { ...resource, links: [] }
    const fetcher = vi.fn()

    const result = await accessResourceLinksForEdit(emptyResource, fetcher)

    expect(typeof result).not.toBe('string')
    expect(readEditContext(result as PatchResource)?.baseLinks).toEqual([])
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects hydration when the DTO base does not match the access version', async () => {
    const { accessResourceLinksForEdit } = await import(
      '~/components/patch/resource/accessResourceLinksForEdit'
    )
    const dtoResource = {
      ...resource,
      baseLinks: [{ id: 21, version: 9 }]
    } as PatchResource
    const fetcher = vi.fn().mockResolvedValueOnce({
      link: {
        id: 21,
        storage: 'user',
        size: '2 GB',
        content: 'https://pan.example.com/share',
        code: 'abcd',
        password: 'secret',
        hash: '',
        version: 2
      }
    })

    const result = await accessResourceLinksForEdit(dtoResource, fetcher)

    expect(result).toBe(LINK_HEALTH_ERRORS.version_conflict.message)
  })
})
