import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  tag: vi.fn(),
  games: vi.fn(),
  scope: vi.fn()
}))
vi.mock('~/app/(site)/tag/[id]/data', () => ({
  getCachedTagById: mocks.tag
}))
vi.mock('~/app/api/tag/service', () => ({ getPatchByTag: mocks.games }))
vi.mock('~/utils/actions/getSessionRenderState', () => ({
  getSessionRenderState: mocks.scope
}))
vi.mock('~/utils/actions/getPatchVisibilityWhere', () => ({
  getPatchVisibilityWhere: vi.fn().mockResolvedValue({ content_limit: 'nsfw' })
}))
vi.mock('~/components/tag/detail/Container', () => ({
  TagDetailContainer: () => null
}))
vi.mock('~/components/kun/BreadcrumbTitle', () => ({
  KunBreadcrumbTitle: () => null
}))
vi.mock('~/components/error/ErrorComponent', () => ({
  ErrorComponent: () => null
}))

beforeEach(() => {
  globalThis.React = React
  mocks.games.mockReset().mockResolvedValue({ galgames: [{ id: 1 }], total: 1 })
  mocks.tag.mockResolvedValue({ id: 15, name: 'Synthetic tag' })
})

describe('tag page initial games', () => {
  it.each(['confirmed-context', 'guest'])(
    'prepares only the visible first result for %s',
    async (identity) => {
      const scope = {
        identity,
        browsingKey: identity === 'guest' ? '["sfw",[]]' : '["nsfw",[]]'
      }
      mocks.scope.mockResolvedValue(scope)
      const { default: Page } = await import('~/app/(site)/tag/[id]/page')
      const page = await Page({
        params: Promise.resolve({ id: '15' }),
        searchParams: Promise.resolve({ page: '2', sortField: 'created' })
      })
      const list = page.props.children[1]
      expect(list.props.initialScope).toEqual(scope)
      expect(list.props.initialFilters.page).toBe(2)
      if (identity === 'guest') {
        expect(mocks.games).not.toHaveBeenCalled()
        expect(list.props.initialGalgames).toEqual([])
      } else {
        expect(mocks.games).toHaveBeenCalledTimes(1)
        expect(mocks.games).toHaveBeenCalledWith(
          expect.objectContaining({ tagId: 15, page: 2, sortField: 'created' }),
          { content_limit: 'nsfw' }
        )
        expect(list.props.initialGalgames).toEqual([{ id: 1 }])
      }
    }
  )
})
