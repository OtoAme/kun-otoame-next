import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.React = React
const mocks = vi.hoisted(() => ({ auth: vi.fn(), submission: vi.fn(), item: vi.fn() }))
vi.mock('~/lib/dashboard/auth', () => ({ requireDashboardUser: mocks.auth }))
vi.mock('~/app/api/admin/patch-submission/service', () => ({ getAdminPatchSubmission: mocks.submission }))
vi.mock('~/app/api/admin/inbox/service', () => ({ getAdminInboxItem: mocks.item }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('not-found') } }))
vi.mock('~/components/submission/PatchSubmissionPreviewView', () => ({ PatchSubmissionPreviewView: () => null }))
vi.mock('~/components/patch/resource/ResourceDownload', () => ({ ResourceDownload: () => null }))

import SubmissionPage from '~/app/(site)/preview/submission/[id]/page'
import ResourcePage from '~/app/(site)/preview/resource/[id]/page'

describe('administrator frontend previews', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue({ id: 1, name: '管理员', role: 3 })
  })
  it.each([SubmissionPage, ResourcePage])('authorizes before loading preview records', async (page) => {
    mocks.auth.mockRejectedValue(new Error('unauthorized'))
    await expect(page({ params: Promise.resolve({ id: '7' }) })).rejects.toThrow('unauthorized')
    expect(mocks.submission).not.toHaveBeenCalled()
    expect(mocks.item).not.toHaveBeenCalled()
  })
  it.each([SubmissionPage, ResourcePage])('rejects invalid record IDs without querying', async (page) => {
    await expect(page({ params: Promise.resolve({ id: '7x' }) })).rejects.toThrow('not-found')
    expect(mocks.submission).not.toHaveBeenCalled()
    expect(mocks.item).not.toHaveBeenCalled()
  })
  it('renders the same submission preview model with its creation time', async () => {
    const preview = { name: '待审投稿' }
    mocks.submission.mockResolvedValue({ preview, created: '2026-09-10T00:00:00Z' })
    const result = await SubmissionPage({ params: Promise.resolve({ id: '7' }) })
    expect(mocks.submission).toHaveBeenCalledWith(7, 3)
    expect(result.props).toEqual({ preview, createdAt: '2026-09-10T00:00:00Z' })
  })
  it('passes authorized pending resource fields only to the read-only renderer', async () => {
    const payload = { id: 7, links: [{ content: 'https://example.com/pending' }] }
    mocks.item.mockResolvedValue({ state: 'pending', item: { kind: 'resource-apply', payload } })
    const result = await ResourcePage({ params: Promise.resolve({ id: '7' }) })
    expect(result.props).toEqual({ resource: payload, preview: true })
  })
  it.each(['processed', 'missing'])('does not preview a %s resource', async (state) => {
    mocks.item.mockResolvedValue({ state, item: state === 'missing' ? null : { kind: 'resource-apply', payload: {} } })
    await expect(ResourcePage({ params: Promise.resolve({ id: '7' }) })).rejects.toThrow('not-found')
  })
})
