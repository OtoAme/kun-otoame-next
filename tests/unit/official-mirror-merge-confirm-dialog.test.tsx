// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MergeConfirmDialog } from '~/components/dashboard/official-mirror/merge/MergeConfirmDialog'
import type { MergePreview } from '~/types/api/officialMirror'

const LONG_NOTE = '站方说明：请核对安装形式与版本。'.repeat(20)
const DOWNLOAD = 'https://example.invalid/should-not-render'
const card = (id: number, name: string, download: number) => ({
  id,
  name,
  section: 'galgame' as const,
  patchId: 4,
  patchUniqueId: 'abcd1234',
  patchName: '核对用游戏',
  publisher: { id: id + 100, name: `发布者${id}` },
  download,
  created: '2026-11-01T00:00:00.000Z',
  status: 0
})
const link = (id: number, storage: string, size: string) => ({
  id,
  storage,
  size,
  content: DOWNLOAD,
  version: 1,
  sortOrder: id,
  changedAt: null,
  backedUpAt: null
})
const previewOf = (extra: Partial<MergePreview> = {}): MergePreview => ({
  classification: 'high',
  canMerge: true,
  blocks: [],
  basis: 'ab'.repeat(32),
  user: card(21, '[JP]社区完整名称', 101),
  staff: card(31, '[PC-JP]官方完整名称 (setup)', 334),
  linkSummary: {
    user: [{ id: 11, storage: 'user', size: '5.69 GB' }],
    staff: [{ id: 12, storage: 'touchgal', size: '6.177 GB' }]
  },
  survivorPreview: {
    name: '[JP]社区完整名称',
    type: ['pc'],
    language: ['zh-Hans'],
    platform: ['windows'],
    note: '社区备注\n站方备份说明',
    noteAppended: true,
    // Deliberately reverse these: original ownership comes from linkSummary.
    links: [link(12, 'touchgal', '6.177 GB'), link(11, 'user', '5.69 GB')]
  },
  fieldComparison: [
    {
      field: '名称',
      user: '[JP]社区完整名称',
      staff: '[PC-JP]官方完整名称 (setup)'
    },
    { field: '类型', user: 'pc', staff: 'pc' },
    { field: '语言', user: 'zh-Hans', staff: 'ja' },
    { field: '平台', user: 'windows', staff: 'windows' },
    { field: '状态', user: '已公开', staff: '已公开' },
    { field: '链接数', user: '1', staff: '1' },
    { field: '备注', user: '社区备注', staff: LONG_NOTE }
  ],
  staffLikeCount: 6,
  exitedPairs: [
    { staffResourceId: 41, staffName: '其他官方资源的完整名称', retained: true }
  ],
  ...extra
})

describe('resource merge confirmation', () => {
  let root: Root
  let container: HTMLDivElement
  const onConfirm = vi.fn()
  const onOpenChange = vi.fn()
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })
  const render = async (
    preview = previewOf(),
    extra: Partial<React.ComponentProps<typeof MergeConfirmDialog>> = {}
  ) => {
    await act(async () =>
      root.render(
        <MergeConfirmDialog
          open
          preview={preview}
          mode="merge"
          pending={false}
          onOpenChange={onOpenChange}
          onConfirm={onConfirm}
          {...extra}
        />
      )
    )
  }
  const dialog = () => document.querySelector('[role="alertdialog"]')!
  const text = () => dialog().textContent ?? ''
  const button = (label: string) => {
    const result = [...dialog().querySelectorAll('button')].find(
      (item) => item.textContent?.trim() === label
    )
    if (!result) throw new Error(`Missing button ${label}: ${text()}`)
    return result
  }
  const checkbox = () =>
    dialog().querySelector<HTMLButtonElement>('[role="checkbox"]')!
  const click = async (element: HTMLElement) => {
    await act(async () => element.click())
  }

  it('shows both original identities, fields, ownership, declared sizes and concrete consequences', async () => {
    await render()
    expect(text()).toContain('将官方资源 #31 并入社区资源 #21')
    expect(text()).toContain('核对用游戏 · 游戏资源')
    const community = dialog().querySelector('[aria-label="社区资源 #21"]')!
    const official = dialog().querySelector('[aria-label="官方资源 #31"]')!
    expect(community.textContent).toContain('[JP]社区完整名称')
    expect(community.textContent).toContain('发布者21')
    expect(community.textContent).toContain('5.69 GB')
    expect(community.textContent).not.toContain('6.177 GB')
    expect(official.textContent).toContain('[PC-JP]官方完整名称 (setup)')
    expect(official.textContent).toContain('发布者31')
    expect(official.textContent).toContain('6.177 GB')
    expect(official.textContent).not.toContain('5.69 GB')
    expect(text()).toContain('2026/11/01 08:00')
    expect(
      community.querySelector('[data-different="true"]')?.textContent
    ).toContain('语言')
    expect(text()).toContain('两侧填写的大小不同')
    expect(text()).toContain('获取次数合计 435（101 + 334）')
    expect(text()).toContain('合并后共 2 条链接：原有 1 条在前，移入 1 条在后')
    expect(text()).toContain('站方备注以「站方备份说明」追加在备注末尾')
    expect(text()).toContain('#31 的 6 个点赞不迁移')
    expect(
      dialog().querySelector('[data-slot="alert-dialog-header"]')?.textContent
    ).toContain('官方资源的 6 个点赞不迁移')
    expect(text()).toContain('旧链接改为定位到 #21')
    expect(text()).not.toContain(DOWNLOAD)
    expect(button('确认合并到 #21').disabled).toBe(true)
  })

  it('expands full notes and other pairs while keeping their resources explicitly preserved', async () => {
    await render()
    expect(text()).not.toContain(LONG_NOTE)
    await click(button('查看完整备注'))
    expect(text()).toContain(LONG_NOTE)
    expect(text()).not.toContain('官方资源 #41 其他官方资源的完整名称')
    await click(button('其他受影响的配对（1）'))
    expect(text()).toContain('官方资源 #41 其他官方资源的完整名称 · 卡片保留')
    expect(text()).toContain('资源卡片仍然保留')
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('requires the explicit checkbox, and cancellation produces no confirmation', async () => {
    await render()
    await click(button('确认合并到 #21'))
    expect(onConfirm).not.toHaveBeenCalled()
    await click(button('取消'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onConfirm).not.toHaveBeenCalled()
    await click(checkbox())
    expect(button('确认合并到 #21').disabled).toBe(false)
    await click(button('确认合并到 #21'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('returns focus to its opening button on dismissal', async () => {
    const trigger = document.createElement('button')
    trigger.textContent = '打开核对弹窗'
    document.body.append(trigger)
    const returnFocusRef = { current: trigger }
    try {
      trigger.focus()
      const preview = previewOf()
      await render(preview, { returnFocusRef })
      expect(document.activeElement).toBe(button('取消'))
      await render(preview, { open: false, returnFocusRef })
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      expect(document.activeElement).toBe(trigger)
    } finally {
      trigger.remove()
    }
  })

  it('resets confirmation after reopening or changing the preview basis', async () => {
    const preview = previewOf()
    await render(preview)
    await click(checkbox())
    await render(preview, { open: false })
    await render(preview)
    expect(checkbox().getAttribute('aria-checked')).toBe('false')
    await click(checkbox())
    await render({ ...preview, basis: 'cd'.repeat(32) })
    expect(checkbox().getAttribute('aria-checked')).toBe('false')
    expect(button('确认合并到 #21').disabled).toBe(true)
  })

  it('locks confirmation, checkbox, cancellation and Escape while submitting', async () => {
    const preview = previewOf()
    await render(preview)
    await click(checkbox())
    await render(preview, { pending: true })
    expect(button('正在提交…').disabled).toBe(true)
    expect(checkbox().disabled).toBe(true)
    expect(button('取消').disabled).toBe(true)
    await click(button('正在提交…'))
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      )
    })
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('keeps checked facts and an actionable error when a request fails', async () => {
    const preview = previewOf()
    await render(preview)
    await click(checkbox())
    await render(preview, { error: '预览已变化，请关闭后重新核对' })
    expect(dialog().querySelector('[role="alert"]')?.textContent).toBe(
      '预览已变化，请关闭后重新核对'
    )
    expect(checkbox().getAttribute('aria-checked')).toBe('true')
    expect(text()).toContain('[PC-JP]官方完整名称 (setup)')
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('states that adding to a batch only queues the pair and uses a non-destructive action', async () => {
    await render(previewOf(), { mode: 'add' })
    expect(text()).toContain('核对并加入批量合并清单')
    expect(text()).toContain('此操作仅加入清单，尚不执行合并')
    expect(text()).toContain('执行时并入后删除')
    expect(button('加入清单').disabled).toBe(true)
    await click(checkbox())
    expect(button('加入清单').getAttribute('data-variant')).toBe('default')
    await click(button('加入清单'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('does not infer a size mismatch from missing values or differences in spacing and case', async () => {
    const preview = previewOf()
    await render({
      ...preview,
      linkSummary: {
        user: [{ id: 11, storage: 'user', size: '' }],
        staff: preview.linkSummary.staff
      }
    })
    expect(text()).toContain('声明大小：未填写')
    expect(text()).not.toContain('两侧填写的大小不同')
    await render({
      ...preview,
      linkSummary: {
        user: [{ id: 11, storage: 'user', size: '1 GB' }],
        staff: [{ id: 12, storage: 'touchgal', size: '1gb' }]
      }
    })
    expect(text()).not.toContain('两侧填写的大小不同')
  })

  it('cannot confirm a blocked preview even after checking', async () => {
    await render(previewOf({ canMerge: false }))
    await click(checkbox())
    expect(button('确认合并到 #21').disabled).toBe(true)
    expect(text()).toContain('这一对当前不能合并')
  })
})
