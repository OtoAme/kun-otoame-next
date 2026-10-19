import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.React = React

const mocks = vi.hoisted(() => ({
  verifyHeaderCookie: vi.fn(),
  getPatchVisibilityWhere: vi.fn(),
  getUserPatch: vi.fn()
}))

vi.mock('~/utils/actions/verifyHeaderCookie', () => ({
  verifyHeaderCookie: mocks.verifyHeaderCookie
}))
vi.mock('~/utils/actions/getPatchVisibilityWhere', () => ({
  getPatchVisibilityWhere: mocks.getPatchVisibilityWhere
}))
vi.mock('~/app/api/user/profile/patch/service', () => ({
  getUserPatch: mocks.getUserPatch
}))
vi.mock('~/components/user/patch/Container', () => ({
  UserPatch: ({ total, uid }: { total: number; uid: number }) => (
    <div data-testid="public-patches" data-uid={uid}>
      公开条目 {total}
    </div>
  )
}))
vi.mock('next/link', () => ({
  default: ({
    children,
    href
  }: {
    children?: React.ReactNode
    href: string
  }) => <a href={href}>{children}</a>
}))

import UserSubmissionPage from '~/app/(site)/user/[id]/submission/page'

describe('public profile submission page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getPatchVisibilityWhere.mockResolvedValue({ status: 0 })
    mocks.getUserPatch.mockResolvedValue({ galgames: [], total: 3 })
  })

  it('keeps the public list and points the owner at the workspace', async () => {
    mocks.verifyHeaderCookie.mockResolvedValue({ uid: 4, name: '作者', role: 1 })
    const html = renderToStaticMarkup(
      await UserSubmissionPage({ params: Promise.resolve({ id: '4' }) })
    )
    expect(mocks.getUserPatch).toHaveBeenCalledTimes(1)
    expect(mocks.getUserPatch).toHaveBeenCalledWith(
      { uid: 4, page: 1, limit: 20 },
      { status: 0 }
    )
    expect(html).toContain('href="/workspace/entries"')
    expect(html).toContain('用户工作台')
    expect(html).toContain('公开条目 3')
    expect(html).not.toContain('投稿额度')
    expect(html).not.toContain('新建投稿')
  })

  it('hides the workspace entry from a visitor', async () => {
    mocks.verifyHeaderCookie.mockResolvedValue({ uid: 9, name: '访客', role: 1 })
    const html = renderToStaticMarkup(
      await UserSubmissionPage({ params: Promise.resolve({ id: '4' }) })
    )
    expect(html).not.toContain('/workspace/entries')
    expect(html).toContain('公开条目 3')
    expect(html).toContain('已发布条目')
  })
})
