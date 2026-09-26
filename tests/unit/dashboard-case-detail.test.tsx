import React, { act } from 'react'
import type { Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CaseDetail } from '~/types/api/case'

const mocks = vi.hoisted(() => ({
  kunFetchGet: vi.fn(),
  kunFetchPost: vi.fn(),
  onProcessed: vi.fn(),
  onStateChanged: vi.fn()
}))

vi.mock('~/utils/kunFetch', () => ({
  kunFetchGet: mocks.kunFetchGet,
  kunFetchPost: mocks.kunFetchPost
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

vi.mock('~/components/dashboard/ui/alert-dialog', async () => {
  const R = await import('react')
  const Ctx = R.createContext<{ onOpenChange: (open: boolean) => void }>({
    onOpenChange: () => {}
  })
  const Block = (slot: string) => {
    function MockBlock({ children }: { children?: React.ReactNode }) {
      return <div data-slot={slot}>{children}</div>
    }
    return MockBlock
  }
  return {
    AlertDialog: ({
      open,
      onOpenChange,
      children
    }: {
      open: boolean
      onOpenChange: (open: boolean) => void
      children?: React.ReactNode
    }) => (
      <Ctx.Provider value={{ onOpenChange }}>
        {open ? <div>{children}</div> : null}
      </Ctx.Provider>
    ),
    AlertDialogContent: ({ children }: { children?: React.ReactNode }) => (
      <div role="alertdialog">{children}</div>
    ),
    AlertDialogCancel: ({
      children,
      disabled
    }: {
      children?: React.ReactNode
      disabled?: boolean
    }) => {
      const { onOpenChange } = R.useContext(Ctx)
      return (
        <button disabled={disabled} onClick={() => onOpenChange(false)}>
          {children}
        </button>
      )
    },
    AlertDialogHeader: Block('alert-dialog-header'),
    AlertDialogTitle: Block('alert-dialog-title'),
    AlertDialogDescription: Block('alert-dialog-description'),
    AlertDialogFooter: Block('alert-dialog-footer')
  }
})

vi.mock('~/components/dashboard/ui/textarea', () => ({
  Textarea: ({ onChange, ...props }: React.ComponentProps<'textarea'>) => (
    <textarea
      {...props}
      onInput={(event) =>
        onChange?.(event as React.ChangeEvent<HTMLTextAreaElement>)
      }
    />
  )
}))

vi.mock('~/components/dashboard/ui/input', () => ({
  Input: ({ onChange, ...props }: React.ComponentProps<'input'>) => (
    <input
      {...props}
      onInput={(event) =>
        onChange?.(event as React.ChangeEvent<HTMLInputElement>)
      }
    />
  )
}))

vi.mock('~/components/dashboard/ui/checkbox', () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
    ...props
  }: React.ComponentProps<'input'> & {
    onCheckedChange?: (checked: boolean) => void
  }) => (
    <input
      {...props}
      type="checkbox"
      checked={checked}
      readOnly
      onClick={() => onCheckedChange?.(!checked)}
    />
  )
}))

vi.mock('~/components/dashboard/ui/select', async () => {
  const R = await import('react')
  const SelectTrigger = () => null
  const SelectContent = ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  )
  return {
    Select: ({
      value,
      onValueChange,
      children
    }: {
      value: string
      onValueChange: (value: string) => void
      children: React.ReactNode
    }) => {
      const elements = R.Children.toArray(children).filter(
        R.isValidElement
      ) as React.ReactElement<{ children?: React.ReactNode }>[]
      const content = elements.find((element) => element.type === SelectContent)
      return (
        <select
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
        >
          {content?.props.children}
        </select>
      )
    },
    SelectTrigger,
    SelectContent,
    SelectItem: (props: React.ComponentProps<'option'>) => (
      <option {...props} />
    ),
    SelectValue: () => null
  }
})

import { DashboardCaseDetail } from '~/components/dashboard/case/DashboardCaseDetail'

globalThis.React = React

const makeDetail = (overrides: Partial<CaseDetail> = {}): CaseDetail => ({
  id: 9,
  kind: 'content_violation',
  targetType: 'comment',
  targetId: 33,
  target: {
    targetType: 'comment',
    targetId: 33,
    deleted: false,
    patch: { id: 3, uniqueId: 'abc', name: '条目A' },
    resource: null,
    label: '评论摘要'
  },
  patchId: 3,
  ownerType: 'staff',
  owner: null,
  reporter: { id: 5, name: '举报人', avatar: '' },
  status: 'open',
  resolution: null,
  public: false,
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
      body: '举报原因正文',
      author: { id: 5, name: '举报人', avatar: '' },
      payload: null,
      created: '2026-09-13T00:00:00.000Z'
    }
  ],
  capabilities: {
    canReply: false,
    canResolve: false,
    canReopen: false,
    canWithdraw: false,
    canConfirm: false,
    canReview: false,
    canPropose: false,
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

describe('dashboard case detail', () => {
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

  const setInput = async (
    element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
    value: string
  ) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        element instanceof dom!.window.HTMLSelectElement
          ? dom!.window.HTMLSelectElement.prototype
          : element instanceof dom!.window.HTMLInputElement
            ? dom!.window.HTMLInputElement.prototype
            : dom!.window.HTMLTextAreaElement.prototype,
        'value'
      )!.set!.call(element, value)
      element.dispatchEvent(
        new dom!.window.Event(
          element instanceof dom!.window.HTMLSelectElement ? 'change' : 'input',
          { bubbles: true }
        )
      )
    })
  }

  it('loads detail via /case/[id] and replies without confirmation', async () => {
    const detail = makeDetail({
      capabilities: {
        canReply: true,
        canResolve: false,
        canReopen: false,
        canWithdraw: false,
        canConfirm: false,
        canReview: false,
        canPropose: false,
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
    const container = await mount(
      <DashboardCaseDetail
        caseId={9}
        onProcessed={mocks.onProcessed}
        onStateChanged={mocks.onStateChanged}
      />
    )
    await flush()

    expect(mocks.kunFetchGet).toHaveBeenCalledWith('/case/9')
    expect(container.textContent).toContain('违规举报')
    expect(container.textContent).toContain('举报人')
    expect(container.textContent).toContain('举报原因正文')

    // 快捷回复填充
    await act(async () => {
      findButton(container, '需要截图')!.click()
    })
    const replyBox = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="回复内容"]'
    )!
    expect(replyBox.value).toBe(
      '请补充相关截图（回复时可以直接附图），方便进一步核对。'
    )

    // 回复不需要二次确认：不出现确认弹窗
    await act(async () => {
      findButton(container, '发送回复')!.click()
    })
    await flush()
    expect(container.querySelector('[role="alertdialog"]')).toBeNull()
    expect(mocks.kunFetchPost).toHaveBeenCalledWith('/admin/case/9/handle', {
      action: 'reply',
      content: '请补充相关截图（回复时可以直接附图），方便进一步核对。'
    })
    expect(mocks.onStateChanged).toHaveBeenCalled()
    expect(mocks.onProcessed).not.toHaveBeenCalled()
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(2)

    // 网络失败保留输入
    await act(async () => {
      findButton(container, '需要截图')!.click()
    })
    mocks.kunFetchPost.mockRejectedValueOnce(new Error('network'))
    await act(async () => {
      findButton(container, '发送回复')!.click()
    })
    await flush()
    expect(
      container.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="回复内容"]'
      )!.value
    ).toBe('请补充相关截图（回复时可以直接附图），方便进一步核对。')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      '网络错误'
    )
  })

  it('labels a null author as a deleted account, never as the reporter', async () => {
    const detail = makeDetail({
      messages: [
        {
          id: 1,
          kind: 'reply',
          event: null,
          body: '举报原因正文',
          author: { id: 5, name: '举报人', avatar: '' },
          payload: null,
          created: '2026-09-13T00:00:00.000Z'
        },
        {
          id: 2,
          kind: 'reply',
          event: null,
          body: '处理方回复正文',
          author: null,
          payload: null,
          created: '2026-09-13T01:00:00.000Z'
        }
      ]
    })
    mocks.kunFetchGet.mockResolvedValue(detailResponse(detail))
    const container = await mount(<DashboardCaseDetail caseId={9} />)
    await flush()

    // 后台视角服务端不脱敏任何作者，所以 author 为 null 只可能是账号已注销；
    // 记到「报告者」名下会把处理方说的话算到举报人头上
    const conversation = container.querySelector(
      'section[aria-label="沟通记录"]'
    )!
    expect(conversation.textContent).toContain('已注销用户')
    expect(conversation.textContent).not.toContain('报告者')
    expect(conversation.textContent).toContain('处理方回复正文')
  })

  it('resolve requires confirmation; cancel writes nothing; conflict keeps dialog', async () => {
    const detail = makeDetail({
      kind: 'other',
      targetType: 'patch',
      capabilities: {
        canReply: false,
        canResolve: true,
        canReopen: false,
        canWithdraw: false,
        canConfirm: false,
        canReview: false,
        canPropose: false,
        canHideResource: false,
        canRestoreResource: false,
        canMoveResource: false,
        canHandleContent: false,
        canConfirmUserHandled: false,
        allowedContentActions: [],
        allowedResolutions: ['handled', 'out_of_scope']
      }
    })
    mocks.kunFetchGet.mockResolvedValue(detailResponse(detail))
    const container = await mount(
      <DashboardCaseDetail
        caseId={9}
        onProcessed={mocks.onProcessed}
        onStateChanged={mocks.onStateChanged}
      />
    )
    await flush()

    const select = container.querySelector('select')!
    await setInput(select as HTMLSelectElement, 'handled')
    await act(async () => {
      findButton(container, '结案')!.click()
    })
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull()
    expect(container.textContent).toContain('已处理')

    // 取消：零写入
    await act(async () => {
      findButton(container, '取消')!.click()
    })
    expect(mocks.kunFetchPost).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alertdialog"]')).toBeNull()

    // 确认后业务冲突（字符串）保留弹窗并提示
    mocks.kunFetchPost.mockResolvedValue('该事项刚刚被其他人处理')
    await act(async () => {
      findButton(container, '结案')!.click()
    })
    await act(async () => {
      findButton(container, '确认')!.click()
    })
    await flush()
    expect(mocks.kunFetchPost).toHaveBeenCalledWith('/admin/case/9/handle', {
      action: 'resolve',
      resolution: 'handled'
    })
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull()
    expect(container.textContent).toContain('该事项刚刚被其他人处理')
    expect(mocks.onStateChanged).toHaveBeenCalled()
    expect(mocks.onProcessed).not.toHaveBeenCalled()

    // 再次确认成功：终结动作回调 onProcessed
    mocks.kunFetchPost.mockResolvedValue({ case: detail, changed: true })
    await act(async () => {
      findButton(container, '确认')!.click()
    })
    await flush()
    expect(mocks.onProcessed).toHaveBeenCalled()
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(2)
  })

  it('reject-like resolution requires reason and posts reject action', async () => {
    const detail = makeDetail({
      kind: 'other',
      targetType: 'patch',
      capabilities: {
        canReply: false,
        canResolve: true,
        canReopen: false,
        canWithdraw: false,
        canConfirm: false,
        canReview: false,
        canPropose: false,
        canHideResource: false,
        canRestoreResource: false,
        canMoveResource: false,
        canHandleContent: false,
        canConfirmUserHandled: false,
        allowedContentActions: [],
        allowedResolutions: ['handled', 'out_of_scope']
      }
    })
    mocks.kunFetchGet.mockResolvedValue(detailResponse(detail))
    mocks.kunFetchPost.mockResolvedValue({ case: detail, changed: true })
    const container = await mount(<DashboardCaseDetail caseId={9} />)
    await flush()

    const select = container.querySelector('select')!
    await setInput(select as HTMLSelectElement, 'out_of_scope')
    await act(async () => {
      findButton(container, '结案')!.click()
    })
    // 无理由不开弹窗；「不在受理范围」须带一篇指南链接（D12）
    expect(container.querySelector('[role="alertdialog"]')).toBeNull()
    expect(container.textContent).toContain(
      '请附上下载、压缩包或投稿指南中的一篇链接'
    )

    const contentBox = container.querySelector<HTMLTextAreaElement>(
      'textarea#case-action-content'
    )!
    await setInput(contentBox, '不在受理范围的理由')
    await act(async () => {
      findButton(container, '结案')!.click()
    })
    expect(container.querySelector('[role="alertdialog"]')).toBeNull()

    await setInput(contentBox, '不在受理范围，请看 /doc/notice/contribute')
    await act(async () => {
      findButton(container, '结案')!.click()
    })
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull()
    await act(async () => {
      findButton(container, '确认')!.click()
    })
    await flush()
    expect(mocks.kunFetchPost).toHaveBeenCalledWith('/admin/case/9/handle', {
      action: 'reject',
      resolution: 'out_of_scope',
      content: '不在受理范围，请看 /doc/notice/contribute'
    })
  })

  it('adopts the original publisher proposal with its note (D20)', async () => {
    const detail = makeDetail({
      ownerType: 'staff',
      escalatedAt: '2026-09-12T00:00:00.000Z',
      messages: [
        {
          id: 21,
          kind: 'system',
          event: 'escalated',
          body: '',
          author: null,
          payload: { escalation_trigger: 'review_request' },
          created: '2026-09-12T00:00:00.000Z'
        },
        {
          id: 22,
          kind: 'system',
          event: 'close_proposed',
          body: '原发布者提请以「已修正」结案。',
          author: null,
          payload: { resolution: 'repaired' },
          created: '2026-09-13T00:00:00.000Z'
        },
        {
          id: 23,
          kind: 'reply',
          event: null,
          body: '已重新上传第 3 分卷',
          author: { id: 2, name: '发布者甲', avatar: '' },
          payload: null,
          created: '2026-09-13T00:00:00.000Z'
        }
      ],
      capabilities: {
        canReply: true,
        canResolve: true,
        canReopen: false,
        canWithdraw: false,
        canConfirm: false,
        canReview: false,
        canPropose: false,
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
    const onProcessed = vi.fn()
    const container = await mount(
      <DashboardCaseDetail caseId={9} onProcessed={onProcessed} />
    )
    await flush()

    // D16: a review handoff is marked; D20: the proposal sits on top.
    expect(container.textContent).toContain('报告者申请复核')
    expect(container.textContent).toContain('原发布者提请以「已修正」结案')
    await act(async () => {
      findButton(container, '采纳')!.click()
    })
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull()
    expect(mocks.kunFetchPost).not.toHaveBeenCalled()
    await act(async () => {
      findButton(container, '确认')!.click()
    })
    await flush()
    expect(mocks.kunFetchPost).toHaveBeenCalledWith('/admin/case/9/handle', {
      action: 'resolve',
      resolution: 'repaired',
      content: '已重新上传第 3 分卷'
    })
    expect(onProcessed).toHaveBeenCalled()
  })

  it('user report handled needs explicit confirmation and non-empty note', async () => {
    const detail = makeDetail({
      targetType: 'user',
      targetId: 200,
      target: {
        targetType: 'user',
        targetId: 200,
        deleted: false,
        patch: null,
        resource: null,
        label: '被举报用户'
      },
      capabilities: {
        canReply: false,
        canResolve: true,
        canReopen: false,
        canWithdraw: false,
        canConfirm: false,
        canReview: false,
        canPropose: false,
        canHideResource: false,
        canRestoreResource: false,
        canMoveResource: false,
        canHandleContent: false,
        canConfirmUserHandled: true,
        allowedContentActions: [],
        allowedResolutions: ['handled', 'not_established']
      }
    })
    mocks.kunFetchGet.mockResolvedValue(detailResponse(detail))
    mocks.kunFetchPost.mockResolvedValue({ case: detail, changed: true })
    const container = await mount(<DashboardCaseDetail caseId={9} />)
    await flush()

    // 用户管理入口提示
    expect(container.querySelector('a[href="/dashboard/user"]')).toBeNull()
    const select = container.querySelector('select')!
    await setInput(select as HTMLSelectElement, 'handled')
    expect(container.querySelector('a[href="/dashboard/user"]')).not.toBeNull()

    // 未勾选确认直接结案 -> 拦截
    await act(async () => {
      findButton(container, '结案')!.click()
    })
    expect(container.querySelector('[role="alertdialog"]')).toBeNull()
    expect(container.textContent).toContain(
      '请先确认已在用户管理完成对该用户的处置'
    )

    // 勾选但无说明 -> 拦截
    const checkbox = container.querySelector<HTMLInputElement>(
      'input#case-handled-user-confirmed'
    )!
    await act(async () => {
      checkbox.click()
    })
    await act(async () => {
      findButton(container, '结案')!.click()
    })
    expect(container.querySelector('[role="alertdialog"]')).toBeNull()
    expect(container.textContent).toContain('请填写处理说明')

    const contentBox = container.querySelector<HTMLTextAreaElement>(
      'textarea#case-action-content'
    )!
    await setInput(contentBox, '已在用户管理封禁该用户')
    await act(async () => {
      findButton(container, '结案')!.click()
    })
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull()
    await act(async () => {
      findButton(container, '确认')!.click()
    })
    await flush()
    expect(mocks.kunFetchPost).toHaveBeenCalledWith('/admin/case/9/handle', {
      action: 'resolve',
      resolution: 'handled',
      content: '已在用户管理封禁该用户',
      handledUserConfirmed: true
    })
  })

  it('hides handled option for user target without confirm capability', async () => {
    const detail = makeDetail({
      targetType: 'user',
      targetId: 200,
      target: {
        targetType: 'user',
        targetId: 200,
        deleted: false,
        patch: null,
        resource: null,
        label: '被举报用户'
      },
      capabilities: {
        canReply: false,
        canResolve: true,
        canReopen: false,
        canWithdraw: false,
        canConfirm: false,
        canReview: false,
        canPropose: false,
        canHideResource: false,
        canRestoreResource: false,
        canMoveResource: false,
        canHandleContent: false,
        canConfirmUserHandled: false,
        allowedContentActions: [],
        allowedResolutions: ['handled', 'not_established']
      }
    })
    mocks.kunFetchGet.mockResolvedValue(detailResponse(detail))
    const container = await mount(<DashboardCaseDetail caseId={9} />)
    await flush()

    const options = [...container.querySelectorAll('select option')].map(
      (option) => option.textContent
    )
    expect(options).toContain('不成立')
    expect(options).not.toContain('已处理')
  })

  it('resource hide/move and content delete all confirm first', async () => {
    const detail = makeDetail({
      kind: 'resource_mismatch',
      targetType: 'resource',
      targetId: 7,
      public: true,
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
      capabilities: {
        canReply: false,
        canResolve: false,
        canReopen: false,
        canWithdraw: false,
        canConfirm: false,
        canReview: false,
        canPropose: false,
        canHideResource: true,
        canRestoreResource: false,
        canMoveResource: false,
        canHandleContent: true,
        canConfirmUserHandled: false,
        allowedContentActions: ['delete'],
        allowedResolutions: []
      }
    })
    mocks.kunFetchGet.mockResolvedValue(detailResponse(detail))
    mocks.kunFetchPost.mockResolvedValue({
      case: detail,
      changed: true,
      action: 'hide'
    })
    const container = await mount(
      <DashboardCaseDetail caseId={9} onProcessed={mocks.onProcessed} />
    )
    await flush()

    // 隐藏资源：确认弹窗 -> POST resource hide
    await act(async () => {
      findButton(container, '隐藏资源')!.click()
    })
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull()
    await act(async () => {
      findButton(container, '确认')!.click()
    })
    await flush()
    expect(mocks.kunFetchPost).toHaveBeenCalledWith('/admin/case/9/resource', {
      action: 'hide'
    })
    expect(mocks.onProcessed).toHaveBeenCalled()

    // 内容处置：确认弹窗 -> POST content delete
    mocks.onProcessed.mockClear()
    await act(async () => {
      findButton(container, '删除被举报评论')!.click()
    })
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull()
    await act(async () => {
      findButton(container, '取消')!.click()
    })
    expect(mocks.kunFetchPost).toHaveBeenCalledTimes(1)
    await act(async () => {
      findButton(container, '删除被举报评论')!.click()
    })
    await act(async () => {
      findButton(container, '确认')!.click()
    })
    await flush()
    expect(mocks.kunFetchPost).toHaveBeenLastCalledWith(
      '/admin/case/9/content',
      { action: 'delete' }
    )
  })

  it('refreshes the list after restoring a hidden resource', async () => {
    const detail = makeDetail({
      kind: 'resource_mismatch',
      targetType: 'resource',
      status: 'resolved',
      resolution: 'escalated_hidden',
      hiddenAt: '2026-09-13T00:00:00.000Z',
      closedAt: '2026-09-13T00:00:00.000Z',
      capabilities: {
        canReply: false,
        canResolve: false,
        canReopen: false,
        canWithdraw: false,
        canConfirm: false,
        canReview: false,
        canPropose: false,
        canHideResource: false,
        canRestoreResource: true,
        canMoveResource: false,
        canHandleContent: false,
        canConfirmUserHandled: false,
        allowedContentActions: [],
        allowedResolutions: []
      }
    })
    mocks.kunFetchGet.mockResolvedValue(detailResponse(detail))
    mocks.kunFetchPost.mockResolvedValue({ case: detail, changed: true })
    const container = await mount(
      <DashboardCaseDetail
        caseId={9}
        onProcessed={mocks.onProcessed}
        onStateChanged={mocks.onStateChanged}
      />
    )
    await flush()

    await act(async () => {
      findButton(container, '恢复资源')!.click()
    })
    expect(mocks.kunFetchPost).not.toHaveBeenCalled()
    await act(async () => {
      findButton(container, '确认')!.click()
    })
    await flush()

    expect(mocks.kunFetchPost).toHaveBeenCalledWith('/admin/case/9/resource', {
      action: 'restore'
    })
    expect(mocks.onStateChanged).toHaveBeenCalledOnce()
    expect(mocks.onProcessed).not.toHaveBeenCalled()
  })

  it('move validates target patch id before confirming', async () => {
    const detail = makeDetail({
      kind: 'resource_wrong_patch',
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
      capabilities: {
        canReply: false,
        canResolve: false,
        canReopen: false,
        canWithdraw: false,
        canConfirm: false,
        canReview: false,
        canPropose: false,
        canHideResource: false,
        canRestoreResource: false,
        canMoveResource: true,
        canHandleContent: false,
        canConfirmUserHandled: false,
        allowedContentActions: [],
        allowedResolutions: []
      }
    })
    mocks.kunFetchGet.mockResolvedValue(detailResponse(detail))
    mocks.kunFetchPost.mockResolvedValue({
      case: detail,
      changed: true,
      action: 'move'
    })
    const container = await mount(<DashboardCaseDetail caseId={9} />)
    await flush()

    const moveInput = container.querySelector<HTMLInputElement>(
      'input#case-move-target'
    )!
    // 与当前条目相同 -> 拦截
    await setInput(moveInput, '3')
    await act(async () => {
      findButton(container, '移动并结案')!.click()
    })
    expect(container.querySelector('[role="alertdialog"]')).toBeNull()
    expect(container.textContent).toContain('目标条目与当前条目相同')

    // 非法 ID -> 拦截
    await setInput(moveInput, 'abc')
    await act(async () => {
      findButton(container, '移动并结案')!.click()
    })
    expect(container.querySelector('[role="alertdialog"]')).toBeNull()

    // 合法 ID -> 确认后 POST
    await setInput(moveInput, '123')
    await act(async () => {
      findButton(container, '移动并结案')!.click()
    })
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull()
    await act(async () => {
      findButton(container, '确认')!.click()
    })
    await flush()
    expect(mocks.kunFetchPost).toHaveBeenCalledWith('/admin/case/9/resource', {
      action: 'move',
      targetPatchId: 123
    })
  })

  it('restore on a closed case confirms but is not treated as queue processing', async () => {
    const detail = makeDetail({
      kind: 'resource_mismatch',
      targetType: 'resource',
      targetId: 7,
      status: 'resolved',
      resolution: 'escalated_hidden',
      hiddenAt: '2026-09-13T03:00:00.000Z',
      closedAt: '2026-09-13T03:00:00.000Z',
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
          status: 1
        }
      },
      capabilities: {
        canReply: false,
        canResolve: false,
        canReopen: false,
        canWithdraw: false,
        canConfirm: false,
        canReview: false,
        canPropose: false,
        canHideResource: false,
        canRestoreResource: true,
        canMoveResource: false,
        canHandleContent: false,
        canConfirmUserHandled: false,
        allowedContentActions: [],
        allowedResolutions: []
      }
    })
    mocks.kunFetchGet.mockResolvedValue(detailResponse(detail))
    mocks.kunFetchPost.mockResolvedValue({
      case: detail,
      changed: true,
      action: 'restore'
    })
    const container = await mount(
      <DashboardCaseDetail caseId={9} onProcessed={mocks.onProcessed} />
    )
    await flush()

    expect(container.textContent).toContain('升级后隐藏')
    await act(async () => {
      findButton(container, '恢复资源')!.click()
    })
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull()
    await act(async () => {
      findButton(container, '确认')!.click()
    })
    await flush()
    expect(mocks.kunFetchPost).toHaveBeenCalledWith('/admin/case/9/resource', {
      action: 'restore'
    })
    // 恢复是已结事项的补充动作，不从收件箱移除
    expect(mocks.onProcessed).not.toHaveBeenCalled()
    expect(mocks.kunFetchGet).toHaveBeenCalledTimes(2)
  })

  it('shoutbox offers takedown and restore from allowedContentActions, both confirmed first', async () => {
    const detail = makeDetail({
      targetType: 'shoutbox',
      targetId: 55,
      target: {
        targetType: 'shoutbox',
        targetId: 55,
        deleted: false,
        patch: { id: 3, uniqueId: 'abc', name: '条目A' },
        resource: null,
        label: '小喇叭内容'
      },
      capabilities: {
        canReply: false,
        canResolve: false,
        canReopen: false,
        canWithdraw: false,
        canConfirm: false,
        canReview: false,
        canPropose: false,
        canHideResource: false,
        canRestoreResource: false,
        canMoveResource: false,
        canHandleContent: true,
        canConfirmUserHandled: false,
        allowedContentActions: ['takedown', 'restore'],
        allowedResolutions: []
      }
    })
    mocks.kunFetchGet.mockResolvedValue(detailResponse(detail))
    mocks.kunFetchPost.mockResolvedValue({
      case: detail,
      changed: true,
      action: 'restore'
    })
    const container = await mount(
      <DashboardCaseDetail caseId={9} onProcessed={mocks.onProcessed} />
    )
    await flush()

    // 两个动作都由服务端给出，恢复小喇叭按误判恢复以「不成立」结案
    await act(async () => {
      findButton(container, '恢复小喇叭')!.click()
    })
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull()
    expect(container.textContent).toContain('误判恢复')
    await act(async () => {
      findButton(container, '确认')!.click()
    })
    await flush()
    expect(mocks.kunFetchPost).toHaveBeenCalledWith('/admin/case/9/content', {
      action: 'restore'
    })
    expect(mocks.onProcessed).toHaveBeenCalled()

    // 下架小喇叭同样先确认
    await act(async () => {
      findButton(container, '下架小喇叭')!.click()
    })
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull()
    await act(async () => {
      findButton(container, '取消')!.click()
    })
    expect(mocks.kunFetchPost).toHaveBeenCalledTimes(1)
  })
})
