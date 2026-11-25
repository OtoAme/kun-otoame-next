// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { UserPatch } from '~/components/user/patch/Container'
import { getUserInfoSchema, getUserPatchSchema } from '~/validations/user'
import { kunFetchGet } from '~/utils/kunFetch'

globalThis.React = React
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

vi.mock('~/utils/kunFetch', () => ({ kunFetchGet: vi.fn() }))
vi.mock('~/components/kun/Loading', () => ({ KunLoading: () => null }))
vi.mock('~/components/kun/Null', () => ({ KunNull: () => null }))
vi.mock('~/components/galgame/Card', () => ({
  GalgameCard: ({ patch }: { patch: GalgameCard }) => (
    <article>{patch.id}</article>
  )
}))
vi.mock('~/components/kun/Pagination', () => ({
  KunPagination: ({
    total,
    onPageChange
  }: {
    total: number
    onPageChange: (page: number) => void
  }) => <button onClick={() => onPageChange(2)}>{total}</button>
}))

afterEach(() => vi.clearAllMocks())

it('fills seven rows before offering a second page and accepts its request', async () => {
  const container = document.createElement('div')
  const root = createRoot(container)
  const entries = Array.from(
    { length: 21 },
    (_, i) => ({ id: i + 1 }) as GalgameCard
  )
  try {
    await act(() =>
      root.render(<UserPatch galgames={entries} total={21} uid={7} />)
    )
    expect(container.querySelectorAll('article')).toHaveLength(21)
    expect(container.querySelector('button')).toBeNull()
    await act(() =>
      root.render(<UserPatch galgames={entries} total={22} uid={7} />)
    )
    expect(container.querySelector('button')?.textContent).toBe('2')
    vi.mocked(kunFetchGet).mockResolvedValue({
      galgames: [{ id: 22 }],
      total: 22
    })
    await act(() => container.querySelector('button')!.click())
    const [, query] = vi.mocked(kunFetchGet).mock.calls[0]
    expect(query).toEqual({ uid: 7, page: 2, limit: 21 })
    expect(getUserPatchSchema.safeParse(query).success).toBe(true)
    expect(getUserInfoSchema.safeParse(query).success).toBe(false)
    expect(container.querySelector('article')?.textContent).toBe('22')
  } finally {
    await act(() => root.unmount())
  }
})
