import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const verifyHeaderCookieMock = vi.hoisted(() => vi.fn())
vi.mock('~/middleware/_verifyHeaderCookie', () => ({
  verifyHeaderCookie: verifyHeaderCookieMock
}))

const checkRateLimitMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/patch-submission/rateLimit', () => ({
  checkPatchSubmissionRateLimit: checkRateLimitMock
}))

const getPreviewMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/patch-submission/service', () => ({
  getPatchSubmissionPublishPreview: getPreviewMock
}))

import { GET } from '~/app/api/patch-submission/[id]/preview/route'

beforeEach(() => {
  vi.clearAllMocks()
  verifyHeaderCookieMock.mockResolvedValue({ uid: 7, role: 1 })
  checkRateLimitMock.mockResolvedValue(null)
  getPreviewMock.mockResolvedValue({ name: 'Preview' })
})

describe('patch submission preview route', () => {
  it('loads only the current author preview and disables caching', async () => {
    const response = await GET(
      new NextRequest('https://example.test/api/patch-submission/12/preview'),
      { params: Promise.resolve({ id: '12' }) }
    )

    expect(getPreviewMock).toHaveBeenCalledWith(12, 7)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    await expect(response.json()).resolves.toEqual({ name: 'Preview' })
  })

  it('rejects malformed ids before the service', async () => {
    const response = await GET(
      new NextRequest('https://example.test/api/patch-submission/12x/preview'),
      { params: Promise.resolve({ id: '12x' }) }
    )

    await expect(response.json()).resolves.toBe('投稿 ID 不正确')
    expect(getPreviewMock).not.toHaveBeenCalled()
  })
})
