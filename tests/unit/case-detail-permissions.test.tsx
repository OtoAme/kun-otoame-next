import React, { act } from 'react'
import type { Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CaseDetail } from '~/types/api/case'

const mocks = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
  kunFetchGet: vi.fn(),
  kunFetchPost: vi.fn(),
  routerPush: vi.fn(),
  user: { uid: 2, name: '发布者甲', role: 1 }
}))

vi.mock('react-hot-toast', () => ({ default: mocks.toast }))
vi.mock('~/utils/kunFetch', () => ({
  kunFetchGet: mocks.kunFetchGet,
  kunFetchPost: mocks.kunFetchPost
}))
vi.mock('~/store/userStore', () => ({
  useUserStore: (selector: (state: { user: typeof mocks.user }) => unknown) =>
    selector({ user: mocks.user })
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.routerPush })
}))

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    className
  }: {
    children?: React.ReactNode
    href: string
    className?: string
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  )
}))

vi.mock('@heroui/react', async () => {
  const R = await import('react')
  const toArray = (children: React.ReactNode): React.ReactElement[] =>
    (Array.isArray(children) ? children : [children]).filter(
      (child): child is React.ReactElement => R.isValidElement(child)
    )
  return {
    Button: ({
      children,
      onPress,
      isDisabled,
      isLoading,
      'aria-label': ariaLabel
    }: {
      children?: React.ReactNode
      onPress?: () => void
      isDisabled?: boolean
      isLoading?: boolean
      'aria-label'?: string
    }) => (
      <button
        aria-label={ariaLabel}
        disabled={isDisabled || isLoading}
        onClick={onPress}
      >
        {children}
      </button>
    ),
    Chip: ({
      children,
      onClick
    }: {
      children?: React.ReactNode
      onClick?: () => void
    }) => <span onClick={onClick}>{children}</span>,
    Modal: ({
      isOpen,
      children
    }: {
      isOpen: boolean
      children?: React.ReactNode
    }) => (isOpen ? <div role="dialog">{children}</div> : null),
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
    ),
    Textarea: ({
      value,
      onValueChange,
      'aria-label': ariaLabel,
      placeholder
    }: {
      value: string
      onValueChange?: (value: string) => void
      'aria-label'?: string
      placeholder?: string
    }) => (
      <textarea
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onValueChange?.(event.target.value)}
      />
    ),
    Select: ({
      children,
      selectedKeys,
      onSelectionChange,
      'aria-label': ariaLabel,
      placeholder
    }: {
      children?: React.ReactNode
      selectedKeys?: string[]
      onSelectionChange?: (keys: Set<string>) => void
      'aria-label'?: string
      placeholder?: string
    }) => (
      <select
        aria-label={ariaLabel}
        value={selectedKeys?.[0] ?? ''}
        onChange={(event) => onSelectionChange?.(new Set([event.target.value]))}
      >
        <option value="">{placeholder ?? ''}</option>
        {toArray(children).map((child) => (
          <option key={String(child.key)} value={String(child.key)}>
            {(child.props as { children?: React.ReactNode }).children}
          </option>
        ))}
      </select>
    ),
    SelectItem: () => null
  }
})

import { CaseDetailContainer } from '~/components/case/CaseDetailContainer'

globalThis.React = React

const makeDetail = (overrides: Partial<CaseDetail> = {}): CaseDetail => ({
  id: 9,
  kind: 'resource_mismatch',
  targetType: 'resource',
  targetId: 7,
  target: {
    targetType: 'resource',
    targetId: 7,
    deleted: false,
    patch: { id: 3, uniqueId: 'abc', name: '条目A' },
    resource: {
      id: 7,
      name: '资源X',
      section: 'galgame',
      patchId: 3,
      patch: { id: 3, uniqueId: 'abc', name: '条目A' },
      status: 0
    }
  },
  patchId: 3,
  ownerType: 'publisher',
  owner: null,
  status: 'open',
  resolution: null,
  public: true,
  source: 'user',
  subscriberCount: 1,
  reopenedCount: 0,
  escalatedAt: null,
  firstOwnerResponseAt: null,
  closedAt: null,
  statusChangedAt: '2026-09-13T00:00:00.000Z',
  queueEnteredAt: '2026-09-13T00:00:00.000Z',
  hiddenAt: null,
  restoredAt: null,
  created: '2026-09-13T00:00:00.000Z',
  updated: '2026-09-13T00:00:00.000Z',
  messages: [
    {
      id: 1,
      kind: 'reply',
      event: null,
      body: '下载下来和描述不一致',
      author: null,
      payload: null,
      created: '2026-09-13T00:00:00.000Z'
    },
    {
      id: 2,
      kind: 'system',
      event: 'escalated',
      body: '',
      author: null,
      payload: { from_owner_id: 42, actor_type: 'system' },
      created: '2026-09-13T01:00:00.000Z'
    }
  ],
  capabilities: {
    canReply: false,
    canResolve: false,
    canReopen: false,
    canHideResource: false,
    canRestoreResource: false,
    canMoveResource: false,
    canHandleContent: false,
    canConfirmUserHandled: false,
    allowedContentActions: [],
    allowedResolutions: []
  },
  ...overrides
})

const detailResponse = (detail: CaseDetail) => ({ case: detail })

describe('case detail permissions', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.user = { uid: 2, name: '发布者甲', role: 1 }
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
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    // react-dom 必须在 window/document stub 之后加载，否则合成事件不生效
    const { createRoot } = await import('react-dom/client')
    const container = dom.window.document.getElementById('root')!
    root = createRoot(container)
    await act(async () => {
      root!.render(ui)
    })
    return container
  }

  const flush = async () => {
    await act(async () => {})
  }

  const findButton = (container: HTMLElement, text: string) =>
    [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes(text)
    )

  it('renders anonymized reporter and system events without payload identity', async () => {
    mocks.kunFetchGet.mockResolvedValue(detailResponse(makeDetail()))
    const container = await mount(<CaseDetailContainer caseId={9} />)
    await flush()

    const text = container.textContent ?? ''
    // 报告者匿名：author 为 null 的消息显示「报告者」，不补查身份
    expect(text).toContain('报告者')
    expect(text).toContain('下载下来和描述不一致')
    // 系统事件回退文案，payload 身份字段不渲染
    expect(text).toContain('已升级为站方处理')
    expect(text).not.toContain('42')
  })

  it('publisher can reply and resolve with confirmation; cancel writes nothing', async () => {
    const detail = makeDetail({
      owner: { id: 2, name: '发布者甲', avatar: '' },
      capabilities: {
        canReply: true,
        canResolve: true,
        canReopen: false,
        canHideResource: false,
        canRestoreResource: false,
        canMoveResource: false,
        canHandleContent: false,
        canConfirmUserHandled: false,
        allowedContentActions: [],
        allowedResolutions: ['repaired', 'unreproducible', 'out_of_scope']
      }
    })
    mocks.kunFetchGet.mockResolvedValue(detailResponse(detail))
    mocks.kunFetchPost.mockResolvedValue({ case: detail, changed: true })
    const container = await mount(<CaseDetailContainer caseId={9} />)
    await flush()

    // 补充说明区域与快捷回复
    expect(container.textContent).toContain('补充说明')
    const quick = [...container.querySelectorAll('span')].find(
      (el) => el.textContent === '需要截图'
    )!
    await act(async () => {
      quick.click()
    })
    const replyBox = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="补充说明内容"]'
    )!
    expect(replyBox.value).toBe('请补充相关截图，方便进一步核对。')

    // 发送回复
    await act(async () => {
      findButton(container, '发送')!.click()
    })
    await flush()
    expect(mocks.kunFetchPost).toHaveBeenCalledWith('/case/9/message', {
      content: '请补充相关截图，方便进一步核对。'
    })

    // 结案：选项只来自 allowedResolutions
    const resolutionSelect = container.querySelector<HTMLSelectElement>(
      'select[aria-label="处理结论"]'
    )!
    const optionTexts = [...resolutionSelect.querySelectorAll('option')].map(
      (option) => option.textContent
    )
    expect(optionTexts).toContain('已修正')
    expect(optionTexts).toContain('无法复现')
    expect(optionTexts).not.toContain('已移动')
    expect(optionTexts).not.toContain('升级后隐藏')

    // 未选结论时点击结案 -> 报错不开弹窗
    mocks.kunFetchPost.mockClear()
    await act(async () => {
      findButton(container, '结案')!.click()
    })
    expect(container.querySelector('[role="dialog"]')).toBeNull()

    await act(async () => {
      Object.getOwnPropertyDescriptor(
        dom!.window.HTMLSelectElement.prototype,
        'value'
      )!.set!.call(resolutionSelect, 'repaired')
      resolutionSelect.dispatchEvent(
        new dom!.window.Event('change', { bubbles: true })
      )
    })
    await act(async () => {
      findButton(container, '结案')!.click()
    })
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()

    // 取消不写请求
    await act(async () => {
      findButton(container, '取消')!.click()
    })
    expect(mocks.kunFetchPost).not.toHaveBeenCalled()
    expect(container.querySelector('[role="dialog"]')).toBeNull()

    // 确认后才请求，content 为空时省略
    await act(async () => {
      findButton(container, '结案')!.click()
    })
    await act(async () => {
      findButton(container, '确认')!.click()
    })
    await flush()
    expect(mocks.kunFetchPost).toHaveBeenCalledWith('/case/9/resolve', {
      resolution: 'repaired'
    })
  })

  it('reporter can reopen within window via confirmation', async () => {
    const detail = makeDetail({
      status: 'resolved',
      resolution: 'unreproducible',
      closedAt: '2026-09-13T02:00:00.000Z',
      capabilities: {
        canReply: false,
        canResolve: false,
        canReopen: true,
        canHideResource: false,
        canRestoreResource: false,
        canMoveResource: false,
        canHandleContent: false,
        canConfirmUserHandled: false,
        allowedContentActions: [],
        allowedResolutions: []
      }
    })
    mocks.kunFetchGet.mockResolvedValue(detailResponse(detail))
    mocks.kunFetchPost.mockResolvedValue({ case: detail, changed: true })
    const container = await mount(<CaseDetailContainer caseId={9} />)
    await flush()

    expect(container.textContent).toContain('结论：无法复现')
    expect(container.textContent).not.toContain('补充说明')

    await act(async () => {
      findButton(container, '重新打开')!.click()
    })
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    await act(async () => {
      findButton(container, '确认')!.click()
    })
    await flush()
    expect(mocks.kunFetchPost).toHaveBeenCalledWith('/case/9/reopen', {})
  })

  it('subscriber view shows only summary and own-submission note', async () => {
    const detail = makeDetail({
      public: false,
      kind: 'content_violation',
      targetType: 'comment',
      subscriberCount: null,
      messages: [],
      viewerSubscription: { subscribed: true, submitted: true },
      target: {
        targetType: 'comment',
        targetId: 33,
        deleted: false,
        patch: { id: 3, uniqueId: 'abc', name: '条目A' },
        resource: null,
        label: '评论摘要'
      }
    })
    mocks.kunFetchGet.mockResolvedValue(detailResponse(detail))
    const container = await mount(<CaseDetailContainer caseId={9} />)
    await flush()

    const text = container.textContent ?? ''
    expect(text).toContain('你已提交过同类举报')
    // subscriberCount 为 null 时不显示人数
    expect(text).not.toContain('人报告')
    // 无对话、无动作区
    expect(text).not.toContain('沟通记录')
    expect(text).not.toContain('补充说明')
    expect(findButton(container, '重新打开')).toBeUndefined()
  })

  it('UI1: staff viewing a publisher-owned case gets the dashboard entry, not the publisher resolve form', async () => {
    mocks.user = { uid: 9, name: '管理员', role: 3 }
    const detail = makeDetail({
      owner: { id: 2, name: '发布者甲', avatar: '' },
      capabilities: {
        canReply: true,
        canResolve: true,
        canReopen: false,
        canHideResource: false,
        canRestoreResource: false,
        canMoveResource: false,
        canHandleContent: false,
        canConfirmUserHandled: false,
        allowedContentActions: [],
        allowedResolutions: ['repaired', 'unreproducible', 'out_of_scope']
      }
    })
    mocks.kunFetchGet.mockResolvedValue(detailResponse(detail))
    const container = await mount(<CaseDetailContainer caseId={9} />)
    await flush()

    // 不显示发布者专用结案表单
    expect(container.querySelector('select[aria-label="处理结论"]')).toBeNull()
    expect(findButton(container, '结案')).toBeUndefined()
    // 站方改为后台入口（mock 的 Button 不渲染 as/href，按文本查找）
    const entry = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('在后台处理')
    )
    expect(entry).not.toBeUndefined()
  })

  it('reopen conflict asks before subscribing, then navigates to the existing case', async () => {
    const detail = makeDetail({
      status: 'resolved',
      resolution: 'unreproducible',
      closedAt: '2026-09-13T02:00:00.000Z',
      capabilities: {
        canReply: false,
        canResolve: false,
        canReopen: true,
        canHideResource: false,
        canRestoreResource: false,
        canMoveResource: false,
        canHandleContent: false,
        canConfirmUserHandled: false,
        allowedContentActions: [],
        allowedResolutions: []
      }
    })
    mocks.kunFetchGet.mockResolvedValue(detailResponse(detail))
    mocks.kunFetchPost.mockResolvedValueOnce({
      conflict: true,
      existingCaseId: 77
    })
    const container = await mount(<CaseDetailContainer caseId={9} />)
    await flush()

    await act(async () => {
      findButton(container, '重新打开')!.click()
    })
    await act(async () => {
      findButton(container, '确认')!.click()
    })
    await flush()

    // 冲突：只展示，不自动提交/关注
    expect(container.textContent).toContain('该目标已有一条正在处理的同类问题')
    expect(mocks.kunFetchPost).toHaveBeenCalledTimes(1)
    expect(mocks.kunFetchPost).toHaveBeenLastCalledWith('/case/9/reopen', {})
    expect(mocks.routerPush).not.toHaveBeenCalled()

    // 说明不足时拦截
    const subscribeButton = findButton(container, '提交并关注现有问题')!
    expect(subscribeButton.disabled).toBe(true)
    await act(async () => {
      const textarea = container.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="提交说明"]'
      )!
      Object.getOwnPropertyDescriptor(
        dom!.window.HTMLTextAreaElement.prototype,
        'value'
      )!.set!.call(textarea, '我这边仍然存在问题，仍然无法下载')
      textarea.dispatchEvent(new dom!.window.Event('input', { bubbles: true }))
    })

    // 提交失败（目标已删除等现有校验）保留说明，不假称成功
    mocks.kunFetchPost.mockResolvedValueOnce('该目标已删除，无法提交')
    await act(async () => {
      findButton(container, '提交并关注现有问题')!.click()
    })
    await flush()
    expect(
      container.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="提交说明"]'
      )!.value
    ).toBe('我这边仍然存在问题，仍然无法下载')
    expect(mocks.toast.success).not.toHaveBeenCalled()
    expect(mocks.routerPush).not.toHaveBeenCalled()

    // 成功后进入现有问题详情
    mocks.kunFetchPost.mockResolvedValueOnce({
      case: { id: 77 },
      created: false,
      subscribed: true
    })
    await act(async () => {
      findButton(container, '提交并关注现有问题')!.click()
    })
    await flush()
    expect(mocks.kunFetchPost).toHaveBeenLastCalledWith('/case', {
      kind: 'resource_mismatch',
      targetType: 'resource',
      targetId: 7,
      content: '我这边仍然存在问题，仍然无法下载'
    })
    expect(mocks.routerPush).toHaveBeenCalledWith('/issue/77')
  })
})
