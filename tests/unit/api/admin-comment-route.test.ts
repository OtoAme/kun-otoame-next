import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  verifyHeaderCookie: vi.fn(),
  getComment: vi.fn(),
  updateComment: vi.fn(),
  deleteComment: vi.fn()
}))

vi.mock('~/middleware/_verifyHeaderCookie', () => ({
  verifyHeaderCookie: mocks.verifyHeaderCookie
}))
vi.mock('~/app/api/admin/comment/get', () => ({ getComment: mocks.getComment }))
vi.mock('~/app/api/admin/comment/update', () => ({
  updateComment: mocks.updateComment
}))
vi.mock('~/app/api/admin/comment/delete', () => ({
  deleteComment: mocks.deleteComment
}))

import { DELETE, GET, PUT } from '~/app/api/admin/comment/route'

const listRequest = () =>
  new NextRequest(
    'https://example.test/api/admin/comment?page=1&limit=30&searchType=content'
  )
const updateRequest = () =>
  new NextRequest('https://example.test/api/admin/comment', {
    method: 'PUT',
    body: JSON.stringify({ commentId: 5, content: '更新后的内容' }),
    headers: { 'content-type': 'application/json' }
  })
const deleteRequest = () =>
  new NextRequest('https://example.test/api/admin/comment?commentIds=5,6', {
    method: 'DELETE'
  })

beforeEach(() => {
  vi.resetAllMocks()
  mocks.getComment.mockResolvedValue({ comments: [], total: 0 })
  mocks.updateComment.mockResolvedValue({})
  mocks.deleteComment.mockResolvedValue({})
})

describe('/api/admin/comment', () => {
  it.each([3, 4])(
    'lets role %s list, edit and delete comments',
    async (role) => {
      mocks.verifyHeaderCookie.mockResolvedValue({ uid: 7, role })

      expect(await (await GET(listRequest())).json()).toEqual({
        comments: [],
        total: 0
      })
      expect(await (await PUT(updateRequest())).json()).toEqual({})
      expect(await (await DELETE(deleteRequest())).json()).toEqual({})
      expect(mocks.updateComment).toHaveBeenCalledWith(
        { commentId: 5, content: '更新后的内容' },
        7
      )
      expect(mocks.deleteComment).toHaveBeenCalledWith(
        { commentIds: [5, 6] },
        7
      )
    }
  )

  it.each([1, 2])('rejects role %s without touching comments', async (role) => {
    mocks.verifyHeaderCookie.mockResolvedValue({ uid: 7, role })

    for (const response of [
      await GET(listRequest()),
      await PUT(updateRequest()),
      await DELETE(deleteRequest())
    ]) {
      expect(await response.json()).toBe('本页面仅管理员可访问')
    }
    expect(mocks.getComment).not.toHaveBeenCalled()
    expect(mocks.updateComment).not.toHaveBeenCalled()
    expect(mocks.deleteComment).not.toHaveBeenCalled()
  })

  it('rejects anonymous requests', async () => {
    mocks.verifyHeaderCookie.mockResolvedValue(null)
    expect(await (await DELETE(deleteRequest())).json()).toBe('用户未登录')
    expect(mocks.deleteComment).not.toHaveBeenCalled()
  })
})
