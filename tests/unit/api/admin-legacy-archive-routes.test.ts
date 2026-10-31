import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  verifyHeaderCookie: vi.fn(),
  getFeedback: vi.fn(),
  getReport: vi.fn()
}))
vi.mock('~/middleware/_verifyHeaderCookie', () => ({
  verifyHeaderCookie: mocks.verifyHeaderCookie
}))
vi.mock('~/app/api/admin/feedback/service', () => ({
  getFeedback: mocks.getFeedback
}))
vi.mock('~/app/api/admin/report/service', () => ({
  getReport: mocks.getReport
}))

import { GET as getFeedbackRoute } from '~/app/api/admin/feedback/route'
import { GET as getReportRoute } from '~/app/api/admin/report/route'

// The console archive pages were dropped (module 10 plan 6.4), so nothing
// administrator-facing reads the legacy feedback and report lists any more.
// Their GET routes go back to super administrator only, matching the legacy
// pages and the handle routes.
describe('legacy feedback and report archive reads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getFeedback.mockResolvedValue({ feedback: [], total: 0 })
    mocks.getReport.mockResolvedValue({ reports: [], total: 0 })
  })

  const cases = [
    {
      name: 'feedback',
      url: 'https://example.test/api/admin/feedback?page=1&limit=10',
      GET: getFeedbackRoute,
      service: () => mocks.getFeedback
    },
    {
      name: 'report',
      url: 'https://example.test/api/admin/report?page=1&limit=10',
      GET: getReportRoute,
      service: () => mocks.getReport
    }
  ]

  for (const { name, url, GET, service } of cases) {
    it(`${name}: an administrator is turned away before the service runs`, async () => {
      mocks.verifyHeaderCookie.mockResolvedValue({ uid: 7, role: 3 })
      const response = await GET(new NextRequest(url))
      expect(response.status).toBe(200)
      expect(await response.json()).toBe('本页面仅超级管理员可访问')
      expect(service()).not.toHaveBeenCalled()
    })

    it(`${name}: a super administrator reads the archive`, async () => {
      mocks.verifyHeaderCookie.mockResolvedValue({ uid: 2, role: 4 })
      const response = await GET(new NextRequest(url))
      expect(await response.json()).toEqual(
        name === 'feedback'
          ? { feedback: [], total: 0 }
          : { reports: [], total: 0 }
      )
      expect(service()).toHaveBeenCalledTimes(1)
    })
  }
})
