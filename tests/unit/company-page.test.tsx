import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { CompanyDetail } from '~/types/api/company'

globalThis.React = React

const mocks = vi.hoisted(() => ({
  getCachedCompanyById: vi.fn(),
  getPatchByCompany: vi.fn()
}))

vi.mock('~/app/company/[id]/data', () => ({
  getCachedCompanyById: mocks.getCachedCompanyById
}))

vi.mock('~/app/api/company/service', () => ({
  getPatchByCompany: mocks.getPatchByCompany
}))

vi.mock('~/utils/actions/getPatchVisibilityWhere', () => ({
  getPatchVisibilityWhere: vi.fn(() => {
    throw new Error('/company/[id] page must not read request cookies')
  })
}))

vi.mock('~/components/company/detail/Container', () => ({
  CompanyDetailContainer: (_props: {
    initialGalgames: GalgameCard[]
    initialTotal: number
    initialVisibility?: 'pending' | 'show'
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
  it('keeps the page static-cache friendly by using an SFW initial list', async () => {
    mocks.getCachedCompanyById.mockResolvedValue(company)
    mocks.getPatchByCompany.mockResolvedValue({
      galgames: [],
      total: 0
    })

    const { default: Page } = await import('~/app/company/[id]/page')
    const element = (await Page({
      params: Promise.resolve({ id: '4' })
    })) as React.ReactElement<{
      initialVisibility?: 'pending' | 'show'
    }>

    expect(mocks.getPatchByCompany).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 4,
        selectedType: 'all',
        selectedLanguage: 'all',
        selectedPlatform: 'all',
        sortField: 'resource_update_time',
        sortOrder: 'desc',
        page: 1,
        limit: 24,
        minRatingCount: 0
      }),
      { content_limit: 'sfw' }
    )
    expect(element.props.initialVisibility).toBe('pending')
  })
})
