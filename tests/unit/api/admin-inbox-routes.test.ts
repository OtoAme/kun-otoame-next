import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  verifyHeaderCookie: vi.fn(),
  getAdminInbox: vi.fn(),
  getAdminInboxItem: vi.fn(),
  getAdminInboxCounts: vi.fn(),
  getAdminPatchSubmission: vi.fn(),
  approvePatchSubmission: vi.fn()
}))

vi.mock('~/middleware/_verifyHeaderCookie', () => ({
  verifyHeaderCookie: mocks.verifyHeaderCookie
}))
vi.mock('~/app/api/admin/inbox/service', () => ({
  getAdminInbox: mocks.getAdminInbox,
  getAdminInboxItem: mocks.getAdminInboxItem,
  getAdminInboxCounts: mocks.getAdminInboxCounts
}))
vi.mock('~/app/api/admin/patch-submission/service', () => ({
  getAdminPatchSubmission: mocks.getAdminPatchSubmission
}))
vi.mock('~/app/api/patch-submission/review', () => ({
  approvePatchSubmission: mocks.approvePatchSubmission,
  rejectPatchSubmission: vi.fn(),
  requestPatchSubmissionChanges: vi.fn(),
  violatePatchSubmission: vi.fn()
}))
vi.mock('~/app/api/patch-submission/quota', () => ({
  PatchSubmissionError: class extends Error {}
}))

import { GET as list } from '~/app/api/admin/inbox/route'
import { GET as item } from '~/app/api/admin/inbox/item/route'
import { GET as counts } from '~/app/api/admin/inbox/counts/route'
import {
  GET as submissionDetail,
  POST as reviewSubmission
} from '~/app/api/admin/patch-submission/[action]/route'
import { PatchSubmissionError } from '~/app/api/patch-submission/quota'
import { PATCH_SUBMISSION_REVIEW_STATE_CHANGED_MESSAGE } from '~/constants/patchSubmission'

const routes = [
  {
    name: 'list',
    run: () => list(new NextRequest('https://example.com/api/admin/inbox')),
    service: mocks.getAdminInbox
  },
  {
    name: 'item',
    run: () =>
      item(
        new NextRequest(
          'https://example.com/api/admin/inbox/item?kind=feedback&id=1'
        )
      ),
    service: mocks.getAdminInboxItem
  },
  {
    name: 'counts',
    run: () =>
      counts(new NextRequest('https://example.com/api/admin/inbox/counts')),
    service: mocks.getAdminInboxCounts
  },
  {
    name: 'submission detail',
    run: () =>
      submissionDetail(
        new NextRequest('https://example.com/api/admin/patch-submission/1'),
        { params: Promise.resolve({ action: '1' }) }
      ),
    service: mocks.getAdminPatchSubmission
  }
]

beforeEach(() => {
  vi.resetAllMocks()
  mocks.verifyHeaderCookie.mockResolvedValue({
    uid: 7,
    name: '审核员',
    role: 3
  })
  for (const route of routes) route.service.mockResolvedValue({ ok: true })
})

describe.each(routes)(
  'admin inbox $name permission and caching',
  ({ run, service }) => {
    it('rejects unsigned requests before accessing business data', async () => {
      mocks.verifyHeaderCookie.mockResolvedValue(null)
      const response = await run()
      expect(await response.json()).toBe('用户未登录')
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      expect(service).not.toHaveBeenCalled()
    })

    it('rejects role 2 independently of middleware', async () => {
      mocks.verifyHeaderCookie.mockResolvedValue({ uid: 7, role: 2 })
      const response = await run()
      expect(typeof (await response.json())).toBe('string')
      expect(service).not.toHaveBeenCalled()
    })

    it.each([3, 4])(
      'allows role %s and never caches personalized results',
      async (role) => {
        mocks.verifyHeaderCookie.mockResolvedValue({ uid: 7, role })
        const response = await run()
        expect(response.status).toBe(200)
        expect(response.headers.get('Cache-Control')).toBe('private, no-store')
        expect(await response.json()).toEqual({ ok: true })
        expect(service).toHaveBeenCalledOnce()
      }
    )
  }
)

describe('admin inbox route parameters', () => {
  it('passes parsed search and candidate limits to the list service', async () => {
    await list(
      new NextRequest(
        'https://example.com/api/admin/inbox?kinds=submission,report&search=%E6%9C%88%E5%85%89&limitPerKind=12&order=kind'
      )
    )
    expect(mocks.getAdminInbox).toHaveBeenCalledWith({
      kinds: ['submission', 'report'],
      search: '月光',
      order: 'kind',
      limitPerKind: 12
    })
  })

  it.each(['kind=report&id=1.5', 'kind=creator&id=1', 'kind=feedback&id=0'])(
    'rejects invalid item query %s',
    async (query) => {
      const response = await item(
        new NextRequest(`https://example.com/api/admin/inbox/item?${query}`)
      )
      expect(typeof (await response.json())).toBe('string')
      expect(mocks.getAdminInboxItem).not.toHaveBeenCalled()
    }
  )

  it('scopes today processed to the authenticated reviewer', async () => {
    await counts(
      new NextRequest(
        'https://example.com/api/admin/inbox/counts?reviewerId=999'
      )
    )
    expect(mocks.getAdminInboxCounts).toHaveBeenCalledWith(7)
  })

  it.each(['approve', '1.2', '1e2', '0', '9007199254740992'])(
    'rejects invalid submission detail segment %s',
    async (action) => {
      const response = await submissionDetail(
        new NextRequest(
          `https://example.com/api/admin/patch-submission/${action}`
        ),
        { params: Promise.resolve({ action }) }
      )
      expect(typeof (await response.json())).toBe('string')
      expect(mocks.getAdminPatchSubmission).not.toHaveBeenCalled()
    }
  )

  it('reuses the existing full submission detail service and authenticated role', async () => {
    await submissionDetail(
      new NextRequest('https://example.com/api/admin/patch-submission/123'),
      { params: Promise.resolve({ action: '123' }) }
    )
    expect(mocks.getAdminPatchSubmission).toHaveBeenCalledWith(123, 3)
  })
})

describe('submission GET coexists with existing review POST', () => {
  it('keeps the existing conflict status and exact error string', async () => {
    mocks.approvePatchSubmission.mockRejectedValue(
      new PatchSubmissionError(PATCH_SUBMISSION_REVIEW_STATE_CHANGED_MESSAGE)
    )
    const response = await reviewSubmission(
      new NextRequest(
        'https://example.com/api/admin/patch-submission/approve',
        {
          method: 'POST',
          body: JSON.stringify({ submissionId: 1 })
        }
      ),
      { params: Promise.resolve({ action: 'approve' }) }
    )
    expect(response.status).toBe(409)
    expect(await response.json()).toBe(
      PATCH_SUBMISSION_REVIEW_STATE_CHANGED_MESSAGE
    )
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(mocks.getAdminPatchSubmission).not.toHaveBeenCalled()
  })

  it('does not interpret numeric detail URLs as a POST action', async () => {
    const response = await reviewSubmission(
      new NextRequest('https://example.com/api/admin/patch-submission/123', {
        method: 'POST',
        body: JSON.stringify({ submissionId: 123 })
      }),
      { params: Promise.resolve({ action: '123' }) }
    )
    expect(await response.json()).toBe('操作不存在')
    expect(mocks.approvePatchSubmission).not.toHaveBeenCalled()
    expect(mocks.getAdminPatchSubmission).not.toHaveBeenCalled()
  })
})
