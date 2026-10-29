import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminResource } from '~/types/api/admin'

const mocks = vi.hoisted(() => ({
  put: vi.fn(),
  success: vi.fn(),
  error: vi.fn()
}))
vi.mock('~/utils/kunFetch', () => ({
  kunFetchPut: mocks.put,
  kunFetchGet: vi.fn(),
  kunFetchPost: vi.fn()
}))
vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), {
    success: mocks.success,
    error: mocks.error
  })
}))
// Plain inputs stand in for the Radix controls; the form logic is under test.
vi.mock('~/components/dashboard/ui/input', () => ({
  Input: ({ onChange, ...props }: React.ComponentProps<'input'>) => (
    <input
      {...props}
      onInput={onChange as React.FormEventHandler<HTMLInputElement>}
    />
  )
}))
vi.mock('~/components/dashboard/ui/textarea', () => ({
  Textarea: ({ onChange, ...props }: React.ComponentProps<'textarea'>) => (
    <textarea
      {...props}
      onInput={onChange as React.FormEventHandler<HTMLTextAreaElement>}
    />
  )
}))
vi.mock('~/components/dashboard/workspace/WorkspaceMultiSelect', () => ({
  WorkspaceMultiSelect: ({ label }: { label: string }) => <span>{label}</span>
}))

import { ResourceEditForm } from '~/components/dashboard/inbox/ResourceEditForm'
import { resourceChanges } from '~/components/dashboard/inbox/resourceChanges'

const resource = (): AdminResource => ({
  id: 5,
  name: '原名称',
  section: 'galgame',
  uniqueId: 'game0001',
  patchName: '游戏',
  type: ['pc', 'row'],
  language: ['ja'],
  platform: ['windows'],
  note: '原备注',
  baseLinks: [{ id: 11, version: 3 }],
  links: [
    {
      id: 11,
      storage: 'user',
      size: '1 GB',
      hash: '',
      sortOrder: 0,
      download: 0,
      content: 'https://example.test/a',
      code: 'abcd',
      password: ''
    }
  ],
  likeCount: 0,
  download: 0,
  isLike: false,
  status: 2,
  userId: 7,
  patchId: 8,
  created: '2026-09-01T00:00:00Z',
  user: { id: 7, name: '发布者', avatar: '', role: 2, patchCount: 1 }
})

describe('resource change list', () => {
  it('lists changed fields with display labels and matches links by ID', () => {
    const before = resource()
    const after = resource()
    after.name = '新名称'
    after.language = ['zh-Hans']
    after.links = [
      { ...before.links[0], code: 'efgh' },
      { ...before.links[0], id: 12, content: 'https://example.test/b' }
    ]
    expect(resourceChanges(before, after)).toEqual([
      { label: '名称', before: '原名称', after: '新名称' },
      { label: '语言', before: '日本語', after: '简体中文' },
      { label: '链接 #1 提取码', before: 'abcd', after: 'efgh' },
      { label: '链接 #2', before: '无', after: '新增（自定义链接下载）' }
    ])
  })

  it('reports removed links and nothing for an unchanged resource', () => {
    const before = resource()
    expect(resourceChanges(before, resource())).toEqual([])
    const after = { ...resource(), links: [] }
    expect(resourceChanges(before, after)).toEqual([
      {
        label: '链接',
        before: '自定义链接下载：https://example.test/a',
        after: '已移除'
      }
    ])
  })
})

describe('in-console resource editor', () => {
  let dom: JSDOM
  let root: Root
  let container: HTMLDivElement
  const saved = vi.fn()
  const cancelled = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost/dashboard'
    })
    vi.stubGlobal('React', React)
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('self', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('navigator', dom.window.navigator)
    vi.stubGlobal('HTMLFormElement', dom.window.HTMLFormElement)
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = dom.window.document.getElementById('root') as HTMLDivElement
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    vi.unstubAllGlobals()
  })

  const render = async () =>
    act(async () =>
      root.render(
        <ResourceEditForm
          resource={resource()}
          reviewerId={34}
          reviewerRole={3}
          onSaved={saved}
          onCancel={cancelled}
        />
      )
    )
  const button = (label: string) =>
    [...container.querySelectorAll('button')].find(
      (item) => item.textContent === label
    ) as HTMLButtonElement
  const type = async (selector: string, value: string) => {
    const field = container.querySelector(selector) as HTMLInputElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(field),
        'value'
      )!.set!
      setter.call(field, value)
      field.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
  }

  it('keeps save disabled until something changes', async () => {
    await render()
    expect(button('保存修改').disabled).toBe(true)
    await type('[aria-label="资源名称"]', '新名称')
    expect(button('保存修改').disabled).toBe(false)
  })

  it('saves through the admin resource route with the captured link versions', async () => {
    mocks.put.mockResolvedValue({ id: 5, links: [], linkChecks: [] })
    await render()
    await type('[aria-label="资源名称"]', '新名称')
    await act(async () => button('保存修改').click())
    expect(mocks.put).toHaveBeenCalledWith('/admin/resource', {
      resourceId: 5,
      patchId: 8,
      baseLinks: [{ id: 11, version: 3 }],
      name: '新名称',
      section: 'galgame',
      note: '原备注',
      type: ['pc', 'row'],
      language: ['ja'],
      platform: ['windows'],
      links: [
        {
          id: 11,
          storage: 'user',
          content: 'https://example.test/a',
          code: 'abcd',
          password: '',
          hash: '',
          size: '1 GB'
        }
      ]
    })
    expect(saved).toHaveBeenCalledTimes(1)
  })

  it('keeps the draft and shows the server message on a conflict', async () => {
    mocks.put.mockResolvedValue('链接已被修改，请刷新后重试')
    await render()
    await type('[aria-label="资源名称"]', '新名称')
    await act(async () => button('保存修改').click())
    expect(saved).not.toHaveBeenCalled()
    expect(container.textContent).toContain('链接已被修改，请刷新后重试')
    expect(
      (container.querySelector('[aria-label="资源名称"]') as HTMLInputElement)
        .value
    ).toBe('新名称')
  })

  it('does not report success for an unrecognized response', async () => {
    mocks.put.mockResolvedValue({})
    await render()
    await type('[aria-label="资源名称"]', '新名称')
    await act(async () => button('保存修改').click())
    expect(saved).not.toHaveBeenCalled()
    expect(container.textContent).toContain('没有确认这次保存是否已经写入')
  })

  it('asks once before discarding edits', async () => {
    await render()
    await act(async () => button('取消').click())
    expect(cancelled).toHaveBeenCalledTimes(1)
    await type('[aria-label="资源名称"]', '新名称')
    await act(async () => button('取消').click())
    expect(cancelled).toHaveBeenCalledTimes(1)
    await act(async () => button('确认放弃修改').click())
    expect(cancelled).toHaveBeenCalledTimes(2)
  })
})
