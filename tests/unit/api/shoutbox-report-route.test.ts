import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  verifyHeaderCookie: vi.fn(),
  createReport: vi.fn()
}))

vi.mock('~/middleware/_verifyHeaderCookie', () => ({
  verifyHeaderCookie: mocks.verifyHeaderCookie
}))
vi.mock('~/app/api/shoutbox/report/service', () => ({
  createReport: mocks.createReport
}))

import { POST } from '~/app/api/shoutbox/report/route'

const request = () =>
  new NextRequest('https://example.test/api/shoutbox/report', {
    method: 'POST',
    body: JSON.stringify({ shoutboxId: 12, content: '违规内容' })
  })

beforeEach(() => {
  vi.resetAllMocks()
  mocks.verifyHeaderCookie.mockResolvedValue({ uid: 8, role: 1 })
  mocks.createReport.mockResolvedValue({})
})

describe('POST /api/shoutbox/report', () => {
  it('requires login before creating a report', async () => {
    mocks.verifyHeaderCookie.mockResolvedValueOnce(null)

    const response = await POST(request())

    expect(await response.json()).toBe('用户未登录')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.createReport).not.toHaveBeenCalled()
  })

  it('returns service rejection strings without converting them to success', async () => {
    mocks.createReport.mockResolvedValueOnce('当前小喇叭不接受举报')

    const response = await POST(request())

    expect(await response.json()).toBe('当前小喇叭不接受举报')
    expect(mocks.createReport).toHaveBeenCalledWith(
      { shoutboxId: 12, content: '违规内容' },
      8
    )
  })
})
