import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const services = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  auth: vi.fn()
}))
vi.mock('~/middleware/_verifyHeaderCookie', () => ({
  verifyHeaderCookie: services.auth
}))
vi.mock('~/app/api/patch/rating/create', () => ({
  createPatchRating: services.create
}))
vi.mock('~/app/api/patch/rating/update', () => ({
  updatePatchRating: services.update
}))
vi.mock('~/app/api/patch/rating/delete', () => ({ deletePatchRating: vi.fn() }))
vi.mock('~/app/api/patch/rating/get', async () => {
  const { z } = await import('zod')
  return { getPatchRating: vi.fn(), getPatchRatingSchema: z.object({}) }
})

import { POST, PUT } from '~/app/api/patch/rating/route'
const content = {
  recommend: 'yes',
  overall: 9,
  playStatus: 'in_progress',
  shortSummary: '合成评价',
  spoilerLevel: 'none'
}
const request = (method: string, body: unknown) =>
  new NextRequest('http://localhost/api/patch/rating', {
    method,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' }
  })

describe('rating create and update HTTP contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    services.auth.mockResolvedValue({ uid: 2, role: 1 })
    services.update.mockResolvedValue({ id: 5, patchId: 7 })
    services.create.mockResolvedValue({ id: 5, patchId: 7 })
  })

  it('requires a game ID only when creating a rating', async () => {
    expect(await (await POST(request('POST', content))).json()).toContain(
      '游戏编号'
    )
    expect(services.create).not.toHaveBeenCalled()
    expect(
      await (await POST(request('POST', { ...content, patchId: 7 }))).json()
    ).toEqual({ id: 5, patchId: 7 })
    expect(
      await (await PUT(request('PUT', { ...content, ratingId: 5 }))).json()
    ).toEqual({ id: 5, patchId: 7 })
  })

  it.each([undefined, null, '', 'bad', 0, -1, 1.5, 10000000])(
    'rejects invalid rating ID %s with the correct field error',
    async (ratingId) => {
      const result = await (
        await PUT(request('PUT', { ...content, ratingId }))
      ).json()
      expect(result).toContain('评价编号')
      expect(services.update).not.toHaveBeenCalled()
    }
  )

  it.each([null, '', 'bad', 0, -1, 1.5, 10000000])(
    'rejects invalid game ID %s on create',
    async (patchId) => {
      expect(
        await (await POST(request('POST', { ...content, patchId }))).json()
      ).toContain('游戏编号')
      expect(services.create).not.toHaveBeenCalled()
    }
  )

  it.each([
    { recommend: 'invalid' },
    { overall: 11 },
    { playStatus: 'invalid' },
    { shortSummary: '长'.repeat(1315) },
    { spoilerLevel: 'invalid' }
  ])('reports invalid rating content separately: %j', async (invalid) => {
    const result = await (
      await PUT(request('PUT', { ...content, ratingId: 5, ...invalid }))
    ).json()
    expect(typeof result).toBe('string')
    expect(result).not.toContain('评价编号')
    expect(result).not.toContain('游戏编号')
    expect(services.update).not.toHaveBeenCalled()
  })

  it('strips an extra game ID and author ID before calling the update service', async () => {
    await PUT(
      request('PUT', { ...content, ratingId: 5, patchId: 99, userId: 99 })
    )
    expect(services.update).toHaveBeenCalledWith(
      { ...content, ratingId: 5 },
      2,
      1
    )
  })

  it('rejects an unauthenticated valid update', async () => {
    services.auth.mockResolvedValue(null)
    expect(
      await (await PUT(request('PUT', { ...content, ratingId: 5 }))).json()
    ).toBe('用户未登录')
    expect(services.update).not.toHaveBeenCalled()
  })
})
