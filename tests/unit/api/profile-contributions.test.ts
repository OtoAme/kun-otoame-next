import { NextRequest } from 'next/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { GET } from '~/app/api/user/profile/contributions/route'

const mocks = vi.hoisted(() => ({
  viewer: vi.fn(),
  visibility: vi.fn(),
  resource: vi.fn(),
  entry: vi.fn(),
  comment: vi.fn(),
  rating: vi.fn()
}))
vi.mock('~/middleware/_verifyHeaderCookie', () => ({
  verifyHeaderCookie: mocks.viewer
}))
vi.mock('~/app/api/utils/getPatchVisibilityWhere', () => ({
  getPatchVisibilityWhere: mocks.visibility
}))
vi.mock('~/prisma/index', () => ({
  prisma: {
    patch_resource: { findMany: mocks.resource },
    patch: { findMany: mocks.entry },
    patch_comment: { findMany: mocks.comment },
    patch_rating: { findMany: mocks.rating }
  }
}))

const request = (year = 2024) =>
  new NextRequest(
    `http://localhost/api/user/profile/contributions?uid=7&year=${year}`
  )
afterEach(() => vi.useRealTimers())
beforeEach(() => {
  vi.resetAllMocks()
  mocks.viewer.mockResolvedValue({ uid: 8 })
  mocks.visibility.mockResolvedValue({ content_limit: 'sfw' })
  for (const source of [
    mocks.entry,
    mocks.resource,
    mocks.comment,
    mocks.rating
  ])
    source.mockResolvedValue([])
})
it('requires login and a valid historical or current year', async () => {
  mocks.viewer.mockResolvedValueOnce(null)
  expect((await GET(request())).status).toBe(401)
  expect((await GET(request(9999))).status).toBe(400)
  expect(mocks.visibility).not.toHaveBeenCalled()
})
it('spans an empty calendar year', async () => {
  expect(await (await GET(request())).json()).toEqual([
    { date: '2024-01-01', count: 0, level: 0, byType: {} },
    { date: '2024-12-31', count: 0, level: 0, byType: {} }
  ])
})
it.each([
  ['2026-11-24T16:00:00Z', '2025-11-26', '2026-11-25', '2026-11-26'],
  ['2023-12-31T16:00:00Z', '2023-01-02', '2024-01-01', '2024-01-02'],
  ['2024-02-28T16:00:00Z', '2023-03-01', '2024-02-29', '2024-03-01'],
  ['2025-02-27T16:00:00Z', '2024-02-29', '2025-02-28', '2025-03-01']
])(
  'defaults to the trailing year through today at %s',
  async (now, first, last, next) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(now))
    const response = await GET(
      new NextRequest('http://localhost/api/user/profile/contributions?uid=7')
    )
    expect(await response.json()).toEqual([
      { date: first, count: 0, level: 0, byType: {} },
      { date: last, count: 0, level: 0, byType: {} }
    ])
    expect(mocks.entry.mock.calls[0][0].where.created).toEqual({
      gte: new Date(`${first}T00:00:00+08:00`),
      lt: new Date(`${next}T00:00:00+08:00`)
    })
  }
)
it('counts all four sources on Shanghai dates using the profile list filters', async () => {
  const leapDay = { created: new Date('2024-02-28T16:00:00Z') }
  mocks.entry.mockResolvedValue([leapDay])
  mocks.comment.mockResolvedValue([
    leapDay,
    { created: new Date('2023-12-31T16:00:00Z') }
  ])
  mocks.resource.mockResolvedValue([leapDay, leapDay])
  mocks.rating.mockResolvedValue([
    leapDay,
    { created: new Date('2024-12-31T15:59:59Z') }
  ])
  const response = await GET(request())
  expect(await response.json()).toEqual([
    { date: '2024-01-01', count: 1, level: 1, byType: { patch_comment: 1 } },
    {
      date: '2024-02-29',
      count: 5,
      level: 3,
      byType: { patch_resource: 2, patch: 1, patch_comment: 1, patch_rating: 1 }
    },
    { date: '2024-12-31', count: 1, level: 1, byType: { patch_rating: 1 } }
  ])
  const scope = {
    user_id: 7,
    created: {
      gte: new Date('2023-12-31T16:00:00Z'),
      lt: new Date('2024-12-31T16:00:00Z')
    }
  }
  expect(mocks.entry.mock.calls[0][0].where).toEqual({
    ...scope,
    content_limit: 'sfw'
  })
  expect(mocks.resource.mock.calls[0][0].where).toEqual({
    ...scope,
    status: 0,
    patch: { content_limit: 'sfw' }
  })
  expect(mocks.comment.mock.calls[0][0].where).toEqual(scope)
  expect(mocks.rating.mock.calls[0][0].where).toEqual(scope)
})
