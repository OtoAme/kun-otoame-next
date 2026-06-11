import React from 'react'
import { describe, expect, it, vi } from 'vitest'

globalThis.React = React

const mocks = vi.hoisted(() => ({
  getGalgame: vi.fn()
}))

vi.mock('~/app/api/otomegame/service', () => ({
  getGalgame: mocks.getGalgame
}))

vi.mock('~/utils/actions/getNSFWHeader', () => ({
  getNSFWHeader: vi.fn(() => {
    throw new Error('/otomegame page must not read request cookies')
  })
}))

vi.mock('~/components/galgame/Container', () => ({
  CardContainer: (_props: {
    initialGalgames: GalgameCard[]
    initialTotal: number
    initialVisibility?: 'pending' | 'show'
  }) => <div data-testid="galgame-container" />
}))

vi.mock('~/components/error/ErrorComponent', () => ({
  ErrorComponent: ({ error }: { error: string }) => <div>{error}</div>
}))

describe('/otomegame page', () => {
  it('keeps the page static-cache friendly by not reading request cookies', async () => {
    mocks.getGalgame.mockResolvedValue({
      galgames: [],
      total: 0
    })

    const { default: Page } = await import('~/app/otomegame/page')
    const element = (await Page()) as React.ReactElement<{
      children: React.ReactElement<{
        initialVisibility?: 'pending' | 'show'
      }>
    }>

    expect(mocks.getGalgame).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedType: 'all',
        selectedLanguage: 'all',
        selectedPlatform: 'all',
        sortField: 'resource_update_time',
        sortOrder: 'desc',
        page: 1,
        limit: 24
      }),
      { content_limit: 'sfw' }
    )
    expect(element.props.children.props.initialVisibility).toBe('pending')
  })
})
