import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  rate: vi.fn(),
  visibility: vi.fn(),
  write: vi.fn()
}))
vi.mock('~/prisma/index', () => ({ prisma: {} }))
vi.mock('~/middleware/_verifyHeaderCookie', () => ({
  verifyHeaderCookie: mocks.auth
}))
vi.mock('~/middleware/_csrf', () => ({ verifyKunCsrf: mocks.csrf }))
vi.mock('~/app/api/patch/resource/link/rateLimit', () => ({
  checkLinkHealthRateLimit: mocks.rate
}))
vi.mock('~/app/api/utils/getPatchVisibilityWhere', () => ({
  getPatchVisibilityWhere: mocks.visibility
}))
import { healthWrite, healthRead } from '~/app/api/patch/resource/link/http'
import {
  linkReportSchema,
  linkHealthQuerySchema
} from '~/validations/linkHealth'
const body = {
  patchId: 1,
  resourceId: 2,
  linkId: 3,
  linkVersion: 1,
  reason: 'deleted'
}
const req = (value: unknown) =>
  new NextRequest('https://example.test/api/patch/resource/link/report', {
    method: 'POST',
    body: JSON.stringify(value),
    headers: { 'Content-Type': 'application/json' }
  })
beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ uid: 7, role: 1 })
  mocks.csrf.mockReturnValue(null)
  mocks.rate.mockResolvedValue(null)
  mocks.visibility.mockResolvedValue({ content_limit: 'sfw' })
  mocks.write.mockResolvedValue({ changed: false })
})
describe('link health HTTP boundary', () => {
  it('authenticates before body/rate/business work and always uses private string errors', async () => {
    mocks.auth.mockResolvedValue(null)
    const result = await healthWrite(
      req(body),
      linkReportSchema,
      mocks.write,
      1,
      true
    )
    expect(result.status).toBe(401)
    expect(result.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.rate).not.toHaveBeenCalled()
    expect(mocks.write).not.toHaveBeenCalled()
  })
  it('rejects insufficient roles and actual CSRF failures before business writes', async () => {
    expect(
      (await healthWrite(req(body), linkReportSchema, mocks.write, 3)).status
    ).toBe(403)
    mocks.csrf.mockReturnValue('csrf')
    expect(
      (await healthWrite(req(body), linkReportSchema, mocks.write)).status
    ).toBe(403)
    expect(mocks.write).not.toHaveBeenCalled()
  })
  it('rate limits before parsing with a positive Retry-After', async () => {
    mocks.rate.mockResolvedValue(9)
    const result = await healthWrite(req(body), linkReportSchema, mocks.write)
    expect(result.status).toBe(429)
    expect(result.headers.get('retry-after')).toBe('9')
    expect(mocks.write).not.toHaveBeenCalled()
  })
  it('rejects slow/weak-unconfirmed/forged-weight requests with zero service effects', async () => {
    for (const value of [
      { ...body, reason: 'slow' },
      { ...body, reason: 'unreachable' },
      { ...body, weight: 9 }
    ])
      expect(
        (await healthWrite(req(value), linkReportSchema, mocks.write, 1, true))
          .status
      ).toBe(400)
    expect(mocks.write).not.toHaveBeenCalled()
  })
  it('passes only validated request plus verified identity/visibility and keeps reads check-free', async () => {
    const result = await healthWrite(
      req(body),
      linkReportSchema,
      mocks.write,
      1,
      true
    )
    expect(result.status).toBe(200)
    expect(mocks.write).toHaveBeenCalledWith(
      body,
      { uid: 7, role: 1 },
      { content_limit: 'sfw' }
    )
    const reader = vi.fn(async () => ({ items: [] }))
    const read = await healthRead(
      new NextRequest(
        'https://example.test/api/patch/resource/link/health?page=1'
      ),
      linkHealthQuerySchema,
      reader
    )
    expect(read.status).toBe(200)
    expect(read.headers.get('cache-control')).toBe('private, no-store')
    expect(reader).toHaveBeenCalledOnce()
  })
})
