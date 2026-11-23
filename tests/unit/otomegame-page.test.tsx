import React from 'react'
import { describe, expect, it, vi } from 'vitest'

globalThis.React = React

const mocks = vi.hoisted(() => ({
  getGalgame: vi.fn()
}))

vi.mock('~/app/api/otomegame/service', () => ({
  getGalgame: mocks.getGalgame
}))

vi.mock('~/utils/actions/getPatchVisibilityWhere', () => ({
  getPatchVisibilityWhere: vi
    .fn()
    .mockResolvedValue({ NOT: { tag: { some: { tag_id: { in: [3] } } } } })
}))
vi.mock('~/utils/actions/getSessionRenderState', () => ({
  getSessionRenderState: vi.fn().mockResolvedValue({
    identity: 'confirmed-context',
    browsingKey: '["all",[3]]'
  })
}))

vi.mock('~/components/galgame/Container', () => ({
  CardContainer: (_props: {
    initialGalgames: GalgameCard[]
    initialTotal: number
    initialScope?: { identity: string; browsingKey: string }
    initialFilters?: { page: number }
  }) => <div data-testid="galgame-container" />
}))

vi.mock('~/components/error/ErrorComponent', () => ({
  ErrorComponent: ({ error }: { error: string }) => <div>{error}</div>
}))

describe('/otomegame page', () => {
  it('prepares one list for the current preferences and URL filters', async () => {
    mocks.getGalgame.mockResolvedValue({
      galgames: [],
      total: 0
    })

    const { default: Page } = await import('~/app/(site)/otomegame/page')
    const element = (await Page({
      searchParams: Promise.resolve({
        page: '2',
        sortField: 'rating',
        minRatingCount: '5'
      })
    })) as React.ReactElement<{
      children: React.ReactElement<{
        initialScope?: { identity: string; browsingKey: string }
        initialFilters?: { page: number }
      }>
    }>

    expect(mocks.getGalgame).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedType: 'all',
        selectedLanguage: 'all',
        selectedPlatform: 'all',
        sortField: 'rating',
        sortOrder: 'desc',
        page: 2,
        limit: 24
      }),
      { NOT: { tag: { some: { tag_id: { in: [3] } } } } }
    )
    expect(element.props.children.props.initialScope).toEqual({
      identity: 'confirmed-context',
      browsingKey: '["all",[3]]'
    })
    expect(element.props.children.props.initialFilters?.page).toBe(2)
    expect(mocks.getGalgame).toHaveBeenCalledTimes(1)
  })
})
