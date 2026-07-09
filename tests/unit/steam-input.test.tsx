import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'

globalThis.React = React

const fetchMock = vi.hoisted(() => ({
  kunFetchGet: vi.fn(),
  kunFetchPost: vi.fn()
}))

const toastMock = vi.hoisted(() => {
  const toast = vi.fn()
  return Object.assign(toast, {
    error: vi.fn(),
    success: vi.fn()
  })
})

vi.mock('~/utils/kunFetch', () => ({
  kunFetchGet: fetchMock.kunFetchGet,
  kunFetchPost: fetchMock.kunFetchPost
}))

vi.mock('react-hot-toast', () => ({
  default: toastMock
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

vi.mock('@heroui/react', () => ({
  Button: ({
    children,
    onPress
  }: {
    children?: React.ReactNode
    onPress?: () => void
  }) => <button onClick={onPress}>{children}</button>,
  Input: ({
    value,
    onChange,
    onPaste
  }: {
    value?: string
    onChange?: React.ChangeEventHandler<HTMLInputElement>
    onPaste?: React.ClipboardEventHandler<HTMLInputElement>
  }) => <input value={value} onChange={onChange} onPaste={onPaste} />
}))

vi.mock('~/components/edit/components/FetchPreview', () => ({
  FetchPreview: () => <div data-testid="fetch-preview" />
}))

const createData = () => ({
  name: 'Steam Shared Bundle',
  vndbId: '',
  vndbRelationId: '',
  bangumiId: '',
  steamId: '3655150',
  dlsiteCode: '',
  dlsiteCircleName: '',
  dlsiteCircleLink: '',
  vndbDevelopers: [],
  bangumiTags: [],
  bangumiDevelopers: [],
  steamTags: [],
  steamDevelopers: [],
  steamAliases: [],
  alias: [],
  introduction: '',
  officialUrl: '',
  released: '',
  tag: [],
  contentLimit: 'sfw',
  isDuplicate: false
})

describe('SteamInput', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  beforeEach(() => {
    fetchMock.kunFetchGet.mockReset()
    fetchMock.kunFetchPost.mockReset()
    toastMock.mockClear()
    toastMock.error.mockClear()
    toastMock.success.mockClear()
  })

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    root = undefined
    dom?.window.close()
    dom = undefined
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('continues fetching Steam metadata when the Steam ID matches another patch', async () => {
    fetchMock.kunFetchGet.mockResolvedValueOnce({ uniqueId: 'steam123' })
    fetchMock.kunFetchPost.mockResolvedValueOnce({
      name: 'Shared Steam Bundle',
      aliases: {},
      releaseDate: '2026-07-09',
      tags: ['Otome'],
      developers: []
    })
    const data = createData()
    const setData = vi.fn()

    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    const { SteamInput } = await import(
      '~/components/edit/components/SteamInput'
    )
    const container = dom.window.document.getElementById('root')
    expect(container).not.toBeNull()
    root = createRoot(container!)

    await act(async () => {
      root!.render(<SteamInput data={data} setData={setData} />)
    })

    await act(async () => {
      container!.querySelector('button')?.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(fetchMock.kunFetchGet).toHaveBeenCalledWith('/edit/duplicate', {
      steamId: '3655150'
    })
    expect(fetchMock.kunFetchPost).toHaveBeenCalledWith('/edit/steam', {
      steamId: '3655150'
    })
    expect(toastMock.error).toHaveBeenCalledWith(
      '发现相同 Steam ID 的已有游戏，请确认是否为合集或共用商店页'
    )
  })
})
