import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { CompanyDetail } from '~/types/api/company'

globalThis.React = React

const mocks = vi.hoisted(() => ({
  getCachedCompanyById: vi.fn(),
  getPatchByCompany: vi.fn()
}))

vi.mock('~/app/(site)/company/[id]/data', () => ({
  getCachedCompanyById: mocks.getCachedCompanyById
}))

vi.mock('~/app/api/company/service', () => ({
  getPatchByCompany: mocks.getPatchByCompany
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

vi.mock('~/components/company/detail/Container', () => ({
  CompanyDetailContainer: (_props: {
    initialGalgames: GalgameCard[]
    initialTotal: number
    initialScope?: { identity: string; browsingKey: string }
    initialFilters?: { page: number }
  }) => <div data-testid="company-detail-container" />
}))

vi.mock('~/components/error/ErrorComponent', () => ({
  ErrorComponent: ({ error }: { error: string }) => <div>{error}</div>
}))

const company: CompanyDetail = {
  id: 4,
  name: 'Company',
  count: 1,
  alias: [],
  introduction: '',
  primary_language: ['ja'],
  official_website: [],
  parent_brand: [],
  created: '2026-01-01T00:00:00.000Z',
  user: {
    id: 1,
    name: 'User',
    avatar: ''
  }
}

describe('/company/[id] page', () => {
  it('prepares one company list for the current preferences and URL filters', async () => {
    mocks.getCachedCompanyById.mockResolvedValue(company)
    mocks.getPatchByCompany.mockResolvedValue({
      galgames: [],
      total: 0
    })

    const { default: Page } = await import('~/app/(site)/company/[id]/page')
    const element = (await Page({
      params: Promise.resolve({ id: '4' }),
      searchParams: Promise.resolve({
        page: '2',
        sortField: 'rating',
        minRatingCount: '5'
      })
    })) as React.ReactElement<{
      initialScope?: { identity: string; browsingKey: string }
      initialFilters?: { page: number }
    }>

    expect(mocks.getPatchByCompany).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 4,
        selectedType: 'all',
        selectedLanguage: 'all',
        selectedPlatform: 'all',
        sortField: 'rating',
        sortOrder: 'desc',
        page: 2,
        limit: 24,
        minRatingCount: 5
      }),
      { NOT: { tag: { some: { tag_id: { in: [3] } } } } }
    )
    expect(element.props.initialScope).toEqual({
      identity: 'confirmed-context',
      browsingKey: '["all",[3]]'
    })
    expect(element.props.initialFilters?.page).toBe(2)
    expect(mocks.getPatchByCompany).toHaveBeenCalledTimes(1)
  })
})
