import { NOTIFICATION_SUBSCRIPTIONS } from '~/constants/notification'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NsfwMode, PreferenceSnapshot } from '~/types/api/preferences'

vi.mock('@heroui/card', () => {
  const Container = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  )
  return { Card: Container, CardBody: Container, CardHeader: Container }
})
vi.mock('@heroui/button', () => ({
  Button: ({
    children,
    onPress,
    isDisabled,
    isLoading
  }: {
    children: React.ReactNode
    onPress?: () => void
    isDisabled?: boolean
    isLoading?: boolean
  }) => (
    <button disabled={isDisabled || isLoading} onClick={onPress}>
      {children}
    </button>
  )
}))
vi.mock('@heroui/select', () => ({
  Select: ({
    onChange,
    selectedKeys,
    isDisabled
  }: {
    onChange: React.ChangeEventHandler<HTMLSelectElement>
    selectedKeys: string[]
    isDisabled: boolean
  }) => (
    <select
      aria-label="网站内容显示"
      value={selectedKeys[0]}
      disabled={isDisabled}
      onChange={onChange}
    >
      <option value="sfw">SFW</option>
      <option value="nsfw">NSFW</option>
      <option value="all">All</option>
    </select>
  ),
  SelectItem: () => null
}))
vi.mock('@heroui/react', () => ({
  Dropdown: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownTrigger: () => null,
  DropdownItem: () => null,
  DropdownMenu: ({
    onSelectionChange,
    selectedKeys
  }: {
    onSelectionChange: (keys: { anchorKey: string }) => void
    selectedKeys: Set<string>
  }) => (
    <select
      aria-label="网站内容显示"
      value={[...selectedKeys][0]}
      onChange={(event) => onSelectionChange({ anchorKey: event.target.value })}
    >
      <option value="sfw">SFW</option>
      <option value="nsfw">NSFW</option>
      <option value="all">All</option>
    </select>
  )
}))

const context = 'a'.repeat(64)
const snapshot = (version: number, mode: NsfwMode): PreferenceSnapshot => ({
  uid: 7,
  context,
  version,
  nsfwSelected: version > 0,
  blockedTagIds: [],
  items: {
    ...Object.fromEntries(
      NOTIFICATION_SUBSCRIPTIONS.map((key) => [
        key,
        { value: true, version: 0 }
      ])
    ),
    nsfw: { value: mode, version },
    'email-notice': { value: false, version: 0 }
  }
})
const transport = vi.fn()
let dom: JSDOM
let root: Root
beforeEach(() => {
  vi.resetModules()
  transport.mockReset()
  dom = new JSDOM('<div id="root"></div>', {
    url: 'https://example.test/settings/user'
  })
  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('localStorage', dom.window.localStorage)
  vi.stubGlobal('fetch', transport)
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  root = createRoot(document.getElementById('root')!)
})
afterEach(async () => {
  await act(async () => root.unmount())
  dom.window.close()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const button = (text: string) =>
  Array.from(document.querySelectorAll('button')).find(
    (element) => element.textContent === text
  )
const select = async (mode: NsfwMode) => {
  await act(async () => {
    const control = document.querySelector('select')!
    control.value = mode
    control.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  })
}

describe.each(['menu', 'settings'] as const)('%s NSFW selection', (surface) => {
  const render = async (version = 1) => {
    const { useUserStore } = await import('~/store/userStore')
    const { usePreferenceStore } = await import('~/store/preferenceStore')
    const client = await import('~/utils/preferenceClient')
    useUserStore.setState({
      user: { ...useUserStore.getState().user, uid: 7 },
      sessionStatus: 'authenticated',
      sessionContext: context,
      sessionGeneration: 1
    })
    usePreferenceStore.setState({
      applied: snapshot(version, 'sfw'),
      generation: 1,
      status: 'ready'
    })
    const { NSFWSwitcher } = await import(
      '~/components/kun/top-bar/NSFWSwitcher'
    )
    const { BrowsingPreference } = await import(
      '~/components/settings/user/BrowsingPreference'
    )
    await act(async () =>
      root.render(
        surface === 'menu' ? <NSFWSwitcher /> : <BrowsingPreference />
      )
    )
    return { useUserStore, usePreferenceStore, client }
  }

  it('requires the first confirmation and immediately saves subsequent selections', async () => {
    const state = await render(0)
    await select('all')
    expect(transport).not.toHaveBeenCalled()
    expect(button('保存设置')).toBeDefined()
    transport.mockResolvedValueOnce(Response.json(snapshot(1, 'all')))
    await act(async () => button('保存设置')!.click())
    expect(state.usePreferenceStore.getState().applied?.nsfwSelected).toBe(true)

    transport.mockResolvedValueOnce(Response.json(snapshot(2, 'nsfw')))
    await select('nsfw')
    expect(transport).toHaveBeenCalledTimes(2)
    expect(state.usePreferenceStore.getState().applied?.items.nsfw.value).toBe(
      'nsfw'
    )
    expect(button('保存设置')).toBeUndefined()
    expect(document.querySelector('[aria-live]')).toBeNull()
  })

  it('saves only NSFW and preserves unrelated drafts and conflicts', async () => {
    const state = await render()
    await act(async () => {
      state.client.editPreference('email-notice', true)
      state.usePreferenceStore.setState({ conflicts: ['email-notice'] })
    })
    expect(button('保存设置')).toBeUndefined()
    transport.mockResolvedValueOnce(Response.json(snapshot(2, 'all')))
    await select('all')
    expect(transport).toHaveBeenCalledOnce()
    expect(JSON.parse(transport.mock.calls[0][1].body).changes).toEqual([
      { key: 'nsfw', value: 'all', version: 1 }
    ])
    expect(state.usePreferenceStore.getState()).toMatchObject({
      drafts: { 'email-notice': { value: true } },
      conflicts: ['email-notice']
    })
    expect(button('保存设置')).toBeUndefined()
  })

  it('keeps the menu compact while saving and retains failed choices for retry', async () => {
    const state = await render()
    let reject!: (error: Error) => void
    transport.mockImplementationOnce(
      () =>
        new Promise<Response>((_, fail) => {
          reject = fail
        })
    )
    await select('all')
    expect(transport).toHaveBeenCalledOnce()
    if (surface === 'menu') {
      expect(document.body.textContent).not.toContain('正在保存')
      expect(document.querySelector('[aria-live]')).toBeNull()
    } else {
      expect(document.body.textContent).toContain('正在保存')
    }
    expect(button('保存设置')).toBeUndefined()
    await act(async () => reject(new TypeError('synthetic offline')))
    expect(state.usePreferenceStore.getState().applied?.items.nsfw.value).toBe(
      'sfw'
    )
    expect(state.usePreferenceStore.getState().drafts.nsfw.value).toBe('all')
    expect(button('保存设置')).toBeDefined()
    await act(async () => window.dispatchEvent(new dom.window.Event('online')))
    expect(transport).toHaveBeenCalledOnce()
    transport.mockResolvedValueOnce(Response.json(snapshot(2, 'all')))
    await act(async () => button('保存设置')!.click())
    expect(state.usePreferenceStore.getState().applied?.items.nsfw.value).toBe(
      'all'
    )
  })

  it('keeps a concurrent conflict explicit and discards only the NSFW draft', async () => {
    const state = await render()
    await act(async () => state.client.editPreference('email-notice', true))
    transport.mockResolvedValueOnce(
      Response.json(
        {
          code: 'PREFERENCE_CONFLICT',
          message: '设置已在其他设备变化',
          conflicts: ['nsfw'],
          snapshot: snapshot(2, 'nsfw')
        },
        { status: 409 }
      )
    )
    await select('all')
    expect(transport).toHaveBeenCalledOnce()
    expect(button('使用服务器设置')).toBeDefined()
    expect(button('保存设置')?.disabled).toBe(true)
    await select('sfw')
    expect(transport).toHaveBeenCalledOnce()
    await act(async () => button('使用服务器设置')!.click())
    expect(state.usePreferenceStore.getState().drafts.nsfw).toBeUndefined()
    expect(
      state.usePreferenceStore.getState().drafts['email-notice'].value
    ).toBe(true)
  })
})
