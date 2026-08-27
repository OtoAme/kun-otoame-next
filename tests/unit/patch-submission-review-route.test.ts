import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PatchSubmissionError } from '~/app/api/patch-submission/quota'

const stateChangedMessage = '投稿已被撤回或处理, 请刷新后重试'

const verifyMock = vi.hoisted(() => vi.fn())
vi.mock('~/middleware/_verifyHeaderCookie', () => ({
  verifyHeaderCookie: verifyMock
}))

const reviewMocks = vi.hoisted(() => ({
  approve: vi.fn(),
  reject: vi.fn(),
  requestChanges: vi.fn(),
  violate: vi.fn()
}))
vi.mock('~/app/api/patch-submission/review', () => ({
  approvePatchSubmission: reviewMocks.approve,
  rejectPatchSubmission: reviewMocks.reject,
  requestPatchSubmissionChanges: reviewMocks.requestChanges,
  violatePatchSubmission: reviewMocks.violate
}))

import { POST } from '~/app/api/admin/patch-submission/[action]/route'

describe('patch submission review route state conflicts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyMock.mockResolvedValue({ uid: 9, name: 'admin', role: 3 })
  })

  it('returns 409 when a stale review action targets a withdrawn submission', async () => {
    reviewMocks.approve.mockRejectedValue(
      new PatchSubmissionError(stateChangedMessage)
    )
    const request = new NextRequest(
      'http://localhost/api/admin/patch-submission/approve',
      {
        method: 'POST',
        body: JSON.stringify({ submissionId: 1 })
      }
    )

    const response = await POST(request, {
      params: Promise.resolve({ action: 'approve' })
    })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toBe(stateChangedMessage)
  })

  it('keeps unrelated reviewer-facing business errors on the existing response path', async () => {
    reviewMocks.approve.mockRejectedValue(
      new PatchSubmissionError('该游戏的外部 ID 已被占用')
    )
    const request = new NextRequest(
      'http://localhost/api/admin/patch-submission/approve',
      {
        method: 'POST',
        body: JSON.stringify({ submissionId: 1 })
      }
    )

    const response = await POST(request, {
      params: Promise.resolve({ action: 'approve' })
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toBe('该游戏的外部 ID 已被占用')
  })
})
