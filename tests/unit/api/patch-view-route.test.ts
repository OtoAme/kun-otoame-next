import { beforeEach, describe, expect, it, vi } from 'vitest'

const updatePatchViewsMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/patch/views/put', () => ({
  updatePatchViews: updatePatchViewsMock
}))

import { POST } from '~/app/api/patch/views/route'

const jsonRequest = (body: unknown) =>
  new Request('https://www.otoame.top/api/patch/views', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })

describe('patch view route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updatePatchViewsMock.mockResolvedValue(undefined)
  })

  it('increments a valid patch view and prevents shared cache storage', async () => {
    const response = await POST(
      jsonRequest({ uniqueId: 'abc12345', currentView: 10 })
    )

    expect(response.status).toBe(200)
    expect(updatePatchViewsMock).toHaveBeenCalledWith('abc12345', 10)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('accepts a view increment without a current view baseline', async () => {
    const response = await POST(jsonRequest({ uniqueId: 'abc12345' }))

    expect(response.status).toBe(200)
    expect(updatePatchViewsMock).toHaveBeenCalledWith('abc12345', undefined)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('rejects invalid patch ids without incrementing views', async () => {
    const response = await POST(jsonRequest({ uniqueId: 'bad', currentView: 1 }))

    expect(response.status).toBe(400)
    expect(await response.json()).toBe('非法浏览量请求')
    expect(updatePatchViewsMock).not.toHaveBeenCalled()
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('rejects malformed JSON without incrementing views', async () => {
    const response = await POST(
      new Request('https://www.otoame.top/api/patch/views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{'
      })
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toBe('非法浏览量请求')
    expect(updatePatchViewsMock).not.toHaveBeenCalled()
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })
})
