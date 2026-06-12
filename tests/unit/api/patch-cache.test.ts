import { beforeEach, describe, expect, it, vi } from 'vitest'

const redisMocks = vi.hoisted(() => ({
  delKv: vi.fn(),
  delKvs: vi.fn(),
  delKvPattern: vi.fn(),
  getKv: vi.fn(),
  getKvs: vi.fn(),
  setKv: vi.fn()
}))

vi.mock('~/lib/redis', () => redisMocks)

const safeRevalidatePathMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/patch/revalidate', () => ({
  safeRevalidatePath: safeRevalidatePathMock
}))

import {
  invalidateCompanyCaches,
  invalidatePatchContentCache,
  invalidatePatchListCaches,
  invalidateTagCaches
} from '~/app/api/patch/cache'

describe('patch cache invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    redisMocks.delKv.mockResolvedValue(undefined)
    redisMocks.delKvs.mockResolvedValue(undefined)
    redisMocks.delKvPattern.mockResolvedValue(undefined)
    redisMocks.getKv.mockResolvedValue(null)
    redisMocks.getKvs.mockResolvedValue([])
    redisMocks.setKv.mockResolvedValue(undefined)
  })

  it('revalidates patch content route after deleting cached patch content', async () => {
    await invalidatePatchContentCache('abc12345')

    expect(redisMocks.delKv).toHaveBeenCalledWith('patch:abc12345')
    expect(redisMocks.delKv).toHaveBeenCalledWith(
      'patch:introduction:abc12345'
    )
    expect(safeRevalidatePathMock).toHaveBeenCalledWith('/abc12345', 'page')
  })

  it('revalidates static list pages after deleting patch list caches', async () => {
    await invalidatePatchListCaches()

    expect(redisMocks.delKvPattern).toHaveBeenCalledWith('home_data:*')
    expect(redisMocks.delKvPattern).toHaveBeenCalledWith('galgame_list:*')
    expect(redisMocks.delKvPattern).toHaveBeenCalledWith('tag_galgame_list:*')
    expect(redisMocks.delKvPattern).toHaveBeenCalledWith(
      'company_galgame_list:*'
    )
    expect(redisMocks.delKvPattern).toHaveBeenCalledWith('anonymous_api:*')
    expect(safeRevalidatePathMock).toHaveBeenCalledWith('/', 'page')
    expect(safeRevalidatePathMock).toHaveBeenCalledWith('/otomegame', 'page')
  })

  it('revalidates company list and company detail paths when company id is known', async () => {
    await invalidateCompanyCaches(7)

    expect(redisMocks.delKvPattern).toHaveBeenCalledWith('company_list:*')
    expect(redisMocks.delKvPattern).toHaveBeenCalledWith(
      'company_galgame_list:*'
    )
    expect(redisMocks.delKvPattern).toHaveBeenCalledWith('anonymous_api:*')
    expect(redisMocks.delKv).toHaveBeenCalledWith('company_detail:7')
    expect(safeRevalidatePathMock).toHaveBeenCalledWith('/company', 'page')
    expect(safeRevalidatePathMock).toHaveBeenCalledWith('/company/7', 'page')
  })

  it('revalidates tag list and tag detail paths when tag id is known', async () => {
    await invalidateTagCaches(15)

    expect(redisMocks.delKvPattern).toHaveBeenCalledWith('tag_list:*')
    expect(redisMocks.delKvPattern).toHaveBeenCalledWith('tag_galgame_list:*')
    expect(redisMocks.delKvPattern).toHaveBeenCalledWith('anonymous_api:*')
    expect(redisMocks.delKv).toHaveBeenCalledWith('tag_detail:15')
    expect(safeRevalidatePathMock).toHaveBeenCalledWith('/tag', 'page')
    expect(safeRevalidatePathMock).toHaveBeenCalledWith('/tag/15', 'page')
  })
})
