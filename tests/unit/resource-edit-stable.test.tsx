import React, { act } from 'react'
import type { Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
  kunFetchPut: vi.fn(),
  linksInputProps: vi.fn()
}))

vi.mock('react-hot-toast', () => ({ default: mocks.toast }))
vi.mock('~/utils/kunFetch', () => ({ kunFetchPut: mocks.kunFetchPut }))

vi.mock('@heroui/button', () => ({
  Button: ({
    children,
    onPress,
    disabled,
    isDisabled,
    isLoading
  }: {
    children?: React.ReactNode
    onPress?: () => void
    disabled?: boolean
    isDisabled?: boolean
    isLoading?: boolean
  }) => (
    <button
      type="button"
      disabled={disabled || isDisabled || isLoading}
      onClick={onPress}
    >
      {children}
    </button>
  )
}))
vi.mock('@heroui/react', () => ({
  ModalContent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ModalHeader: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ModalBody: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ModalFooter: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  )
}))

// 子表单只看链接/正文控制，稳定槽位行为集中在弹窗本体与 baseLinks 提交。
vi.mock('~/components/patch/resource/publish/ResourceSectionSelect', () => ({
  ResourceSectionSelect: () => <div />
}))
vi.mock('~/components/patch/resource/publish/ResourceLinksInput', () => ({
  ResourceLinksInput: (props: Record<string, unknown>) => {
    mocks.linksInputProps(props)
    return <div data-testid="links-input" />
  }
}))
vi.mock('~/components/patch/resource/publish/ResourceDetailsForm', () => ({
  ResourceDetailsForm: () => <div />
}))

import { EditResourceDialog } from '~/components/patch/resource/edit/EditResourceDialog'
import { withEditContext } from '~/components/patch/resource/accessResourceLinksForEdit'
import { LINK_HEALTH_ERRORS } from '~/constants/linkHealth'
import type { PatchResource } from '~/types/api/patch'

globalThis.React = React

const resource: PatchResource = {
  id: 11,
  name: '测试资源',
  section: 'galgame',
  uniqueId: 'ABCDEFGH',
  type: ['pc', 'official-zh'],
  language: ['zh-Hans'],
  platform: ['windows'],
  note: '',
  links: [
    {
      id: 21,
      storage: 'user',
      size: '2 GB',
      content: 'https://pan.example.com/share',
      code: 'abcd',
      password: 'secret',
      hash: '',
      sortOrder: 1,
      download: 0
    }
  ],
  likeCount: 0,
  download: 0,
  isLike: false,
  status: 0,
  userId: 3,
  patchId: 7,
  created: '2026-07-06T00:00:00.000Z',
  user: { id: 3, name: 'Saya', avatar: '', patchCount: 1, role: 2 }
}

const successResponse = () => ({
  ...resource,
  linkChecks: []
})

describe('EditResourceDialog stable slots (M04-1)', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    root = undefined
    dom = undefined
    vi.unstubAllGlobals()
  })

  const mount = async (ui: React.ReactElement) => {
    act(() => {
      root?.unmount()
    })
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const { createRoot } = await import('react-dom/client')
    const container = dom.window.document.getElementById('root')!
    root = createRoot(container)
    await act(async () => {
      root!.render(ui)
    })
    return container
  }

  const findButton = (container: HTMLElement, text: string) =>
    [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes(text)
    )!

  it('submits the captured baseLinks and preserves existing link IDs', async () => {
    mocks.kunFetchPut.mockResolvedValue(successResponse())
    const stable = withEditContext(
      structuredClone(resource),
      { baseLinks: [{ id: 21, version: 3 }] }
    )
    const container = await mount(
      <EditResourceDialog
        resource={stable}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    )

    await act(async () => {
      findButton(container, '保存')!.click()
    })
    await act(async () => {})

    expect(mocks.kunFetchPut).toHaveBeenCalledTimes(1)
    const [url, body] = mocks.kunFetchPut.mock.calls[0]
    expect(url).toBe('/patch/resource')
    expect(body.resourceId).toBe(11)
    expect(body.baseLinks).toEqual([{ id: 21, version: 3 }])
    expect(body.links[0].id).toBe(21)
    expect(body.links[0].content).toBe('https://pan.example.com/share')
    expect(mocks.toast.success).toHaveBeenCalledWith('资源更新成功')
  })

  it('fails closed with refresh guidance and no PUT when no baseline was captured', async () => {
    const onClose = vi.fn()
    const container = await mount(
      <EditResourceDialog
        resource={structuredClone(resource)}
        onClose={onClose}
        onSuccess={vi.fn()}
        type="admin"
      />
    )

    const text = container.textContent ?? ''
    expect(text).toContain('链接编辑基点缺失或已过期')
    expect(text).toContain('请关闭本窗口、刷新数据后重新打开编辑')
    // 失败关闭：没有表单与保存入口，绝不发旧形状请求
    expect(findButton(container, '保存')).toBeUndefined()
    expect(mocks.kunFetchPut).not.toHaveBeenCalled()
    await act(async () => {
      findButton(container, '关闭')!.click()
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps the open-snapshot draft when the parent refreshes the same resource prop', async () => {
    mocks.kunFetchPut.mockResolvedValue(successResponse())
    const stable = withEditContext(structuredClone(resource), {
      baseLinks: [{ id: 21, version: 3 }]
    })
    const container = await mount(
      <EditResourceDialog
        resource={stable}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    )

    // 后台列表刷新：同一资源换一个对象引用（带更新字段与新基点）传入
    const refreshed = withEditContext(structuredClone(resource), {
      baseLinks: [{ id: 21, version: 3 }]
    })
    refreshed.name = '后台刷新后的新名称'
    await act(async () => {
      root!.render(
        <EditResourceDialog
          resource={refreshed}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      )
    })
    await act(async () => {})

    // 仍以打开时的快照为准提交（草稿锚定），不回灌刷新后的对象
    await act(async () => {
      findButton(container, '保存')!.click()
    })
    await act(async () => {})
    expect(mocks.kunFetchPut).toHaveBeenCalledTimes(1)
    const [, body] = mocks.kunFetchPut.mock.calls[0]
    expect(body.name).toBe('测试资源')
    expect(body.baseLinks).toEqual([{ id: 21, version: 3 }])
  })

  it('keeps the draft and never auto-resubmits on a named 409', async () => {
    mocks.kunFetchPut.mockResolvedValue(
      LINK_HEALTH_ERRORS.resource_conflict.message
    )
    const stable = withEditContext(structuredClone(resource), {
      baseLinks: [{ id: 21, version: 3 }]
    })
    const container = await mount(
      <EditResourceDialog
        resource={stable}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    )

    await act(async () => {
      findButton(container, '保存')!.click()
    })
    await act(async () => {})

    expect(mocks.kunFetchPut).toHaveBeenCalledTimes(1)
    expect(mocks.toast.error).toHaveBeenCalledWith(
      LINK_HEALTH_ERRORS.resource_conflict.message
    )
    // 弹内持久提示，草稿保留，绝不静默刷新重交
    expect(container.textContent).toContain(
      LINK_HEALTH_ERRORS.resource_conflict.message
    )
    expect(container.textContent).toContain('您的修改已保留')
    expect(findButton(container, '保存')!.disabled).toBe(false)
  })

  it('warns when post-save link checks failed or were superseded without undoing the save', async () => {
    mocks.kunFetchPut.mockResolvedValue({
      ...successResponse(),
      linkChecks: [
        {
          linkId: 21,
          linkVersion: 4,
          outcome: 'failed',
          check: {
            verdict: 'unknown',
            provider: null,
            reason: 'timeout',
            failed: true,
            checkedAt: null,
            attemptedAt: '2026-10-09T01:00:00.000Z',
            stale: false
          }
        },
        { linkId: 22, linkVersion: 2, outcome: 'superseded', check: null }
      ]
    })
    const stable = withEditContext(structuredClone(resource), {
      baseLinks: [{ id: 21, version: 3 }]
    })
    const onSuccess = vi.fn()
    const container = await mount(
      <EditResourceDialog
        resource={stable}
        onClose={vi.fn()}
        onSuccess={onSuccess}
      />
    )

    await act(async () => {
      findButton(container, '保存')!.click()
    })
    await act(async () => {})

    expect(onSuccess).toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.stringContaining('自动检测未完成或结果已过期')
    )
  })

  it('passes the relink focus down to the links form', async () => {
    const stable = withEditContext(structuredClone(resource), {
      baseLinks: [{ id: 21, version: 3 }],
      focusLinkId: 21
    })
    await mount(
      <EditResourceDialog
        resource={stable}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    )

    expect(mocks.linksInputProps).toHaveBeenCalledWith(
      expect.objectContaining({ focusLinkId: 21 })
    )
  })
})

describe('RUI-04 edit-context identity across target switches', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    root = undefined
    dom = undefined
    vi.unstubAllGlobals()
  })

  const mount = async (ui: React.ReactElement) => {
    act(() => {
      root?.unmount()
    })
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const { createRoot } = await import('react-dom/client')
    const container = dom.window.document.getElementById('root')!
    root = createRoot(container)
    await act(async () => {
      root!.render(ui)
    })
    return container
  }

  const rerender = async (ui: React.ReactElement) => {
    await act(async () => {
      root!.render(ui)
    })
  }

  const findButton = (container: HTMLElement, text: string) =>
    [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes(text)
    )!

  it('fails closed on a context-less new target instead of reusing the old baseline', async () => {
    const stableA = withEditContext(structuredClone(resource), {
      baseLinks: [{ id: 21, version: 3 }]
    })
    const container = await mount(
      <EditResourceDialog
        resource={stableA}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    )
    expect(findButton(container, '保存')).not.toBeUndefined()

    // 换目标且新目标无基点：失败关闭，绝不能带着 A 的基点提交 B
    const targetB = {
      ...structuredClone(resource),
      id: 12,
      name: '目标B',
      links: [{ ...structuredClone(resource).links[0], id: 41 }]
    }
    await rerender(
      <EditResourceDialog
        resource={targetB}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    )
    expect(container.textContent).toContain('链接编辑基点缺失或已过期')
    expect(findButton(container, '保存')).toBeUndefined()
    expect(mocks.kunFetchPut).not.toHaveBeenCalled()

    // 新目标带合法基点：表单以新基点重建并可提交
    mocks.kunFetchPut.mockResolvedValueOnce({
      ...targetB,
      linkChecks: []
    })
    const stableB = withEditContext({ ...targetB }, {
      baseLinks: [{ id: 41, version: 1 }]
    })
    await rerender(
      <EditResourceDialog
        resource={stableB}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    )
    expect(container.textContent).not.toContain('链接编辑基点缺失或已过期')
    await act(async () => {
      findButton(container, '保存')!.click()
    })
    await act(async () => {})
    const [url, body] = mocks.kunFetchPut.mock.calls[0]
    expect(url).toBe('/patch/resource')
    expect(body.resourceId).toBe(12)
    expect(body.baseLinks).toEqual([{ id: 41, version: 1 }])
  })
})

describe('immutable per-session baseline on same-id refresh', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    root = undefined
    dom = undefined
    vi.unstubAllGlobals()
  })

  const mount = async (ui: React.ReactElement) => {
    act(() => {
      root?.unmount()
    })
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const { createRoot } = await import('react-dom/client')
    const container = dom.window.document.getElementById('root')!
    root = createRoot(container)
    await act(async () => {
      root!.render(ui)
    })
    return container
  }

  const rerender = async (ui: React.ReactElement) => {
    await act(async () => {
      root!.render(ui)
    })
  }

  const findButton = (container: HTMLElement, text: string) =>
    [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes(text)
    )!

  it('keeps the OPEN baseline even when the same resource refreshes to a newer server baseline (v3→v4)', async () => {
    mocks.kunFetchPut.mockResolvedValue(successResponse())
    const openedV3 = withEditContext(structuredClone(resource), {
      baseLinks: [{ id: 21, version: 3 }]
    })
    const container = await mount(
      <EditResourceDialog
        resource={openedV3}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    )

    // 服务端已由他人补链到 v4，列表刷新把新对象塞给同一编辑会话：
    // 会话保持 v3 基点与草稿，服务端将以 409 保护并发而不是静默覆盖
    const refreshedV4 = withEditContext(
      { ...structuredClone(resource), name: '被别人补过链的资源' },
      { baseLinks: [{ id: 21, version: 4 }] }
    )
    await rerender(
      <EditResourceDialog
        resource={refreshedV4}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    )
    await act(async () => {})
    await act(async () => {
      findButton(container, '保存')!.click()
    })
    await act(async () => {})

    const [, body] = mocks.kunFetchPut.mock.calls[0]
    expect(body.resourceId).toBe(11)
    expect(body.baseLinks).toEqual([{ id: 21, version: 3 }])
    expect(body.name).toBe('测试资源') // 草稿锚定打开快照
  })
})
