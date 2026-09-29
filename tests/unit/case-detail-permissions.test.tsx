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
          aria-label="处理结论"
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

import { IssueCaseDetail } from '~/components/dashboard/issue/IssueCaseDetail'

globalThis.React = React

const NOW = Date.parse('2026-09-16T00:00:00.000Z')

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
    canWithdraw: false,
    canConfirm: false,
    canReview: false,
    canPropose: false,
    canHideResource: false,
    canRestoreResource: false,
    canMoveResource: false,
    canHandleContent: false,
    canConfirmUserHandled: false,
    canHideMessages: false,
    allowedContentActions: [],
    allowedResolutions: []
  },
  ...overrides
})

const detailResponse = (detail: CaseDetail) => ({ case: detail })

describe('issue case detail permissions', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.user = { uid: 2, name: '发布者甲', role: 1 }
    // 详情里的时限提示与重开剩余时间都读 Date.now()，固定住才有确定的文案
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
  })

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    root = undefined
    dom = undefined
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
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

  const replyBox = (container: HTMLElement) =>
    container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="补充说明内容"]'
    )

  // React 受控组件：直接赋值会被 value tracker 忽略，需要 native setter + input 事件
  const typeInto = async (
    container: HTMLElement,
    selector: string,
    value: string
  ) => {
    const textarea = container.querySelector<HTMLTextAreaElement>(selector)!
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        dom!.window.HTMLTextAreaElement.prototype,
        'value'
      )!.set!.call(textarea, value)
      textarea.dispatchEvent(new dom!.window.Event('input', { bubbles: true }))
    })
  }

  const chooseResolution = async (container: HTMLElement, value: string) => {
    const select = container.querySelector<HTMLSelectElement>(
      'select[aria-label="处理结论"]'
    )!
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        dom!.window.HTMLSelectElement.prototype,
        'value'
      )!.set!.call(select, value)
      select.dispatchEvent(new dom!.window.Event('change', { bubbles: true }))
    })
  }

  const capabilities = (
    overrides: Partial<CaseDetail['capabilities']>
  ): CaseDetail['capabilities'] => ({
    ...makeDetail().capabilities,
    ...overrides
  })

  it('renders anonymized reporter and system events without payload identity', async () => {
    mocks.kunFetchGet.mockResolvedValue(detailResponse(makeDetail()))
    const container = await mount(<IssueCaseDetail caseId={9} />)
    await flush()

    const text = container.textContent ?? ''
    // 报告者匿名：author 为 null 的消息显示「报告者」，不补查身份
    expect(text).toContain('报告者')
    expect(text).toContain('下载下来和描述不一致')
    // 系统事件回退文案，payload 身份字段不渲染
    expect(text).toContain('已提交给网站管理员处理')
    expect(text).not.toContain('42')
  })

  it('keeps the escalation countdown out of a subscriber view', async () => {
    // 同一条事项的两种视角。时限提示本身保留（PM 3.3 的 7 天升级是产品行为，
    // 不是参考图那套可配置 SLA），但 PM 3.6 的关注者可见清单里没有等待时长，
    // 所以只有能回复的一方（报告者本人／当前处理方）才看得到。
    const base = makeDetail()
    mocks.kunFetchGet.mockResolvedValue(detailResponse(base))
    let container = await mount(<IssueCaseDetail caseId={9} />)
    await flush()
    expect(base.capabilities.canReply).toBe(false)
    expect(container.textContent).not.toContain('发布者处理中，约')

    act(() => {
      root?.unmount()
    })
    root = undefined
    mocks.kunFetchGet.mockResolvedValue(
      detailResponse(
        makeDetail({
          capabilities: { ...base.capabilities, canReply: true }
        })
      )
    )
    container = await mount(<IssueCaseDetail caseId={9} />)
    await flush()
    // 同一份数据换成可回复的视角就该看到，证明是 canReply 收窄而不是文案没了
    expect(container.textContent).toContain(
      '发布者处理中，约 4 天后提交给网站管理员处理'
    )
  })

  it('publisher can reply and resolve with confirmation; cancel writes nothing', async () => {
    const detail = makeDetail({
      owner: { id: 2, name: '发布者甲', avatar: '' },
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
        canHideMessages: false,
        allowedContentActions: [],
        allowedResolutions: ['repaired', 'unreproducible', 'out_of_scope']
      }
    })
    mocks.kunFetchGet.mockResolvedValue(detailResponse(detail))
    mocks.kunFetchPost.mockResolvedValue({ case: detail, changed: true })
    const container = await mount(<IssueCaseDetail caseId={9} />)
    await flush()

    // 快捷回复只给处理方（当前发布者），不给报告者
    await act(async () => {
      findButton(container, '需要截图')!.click()
    })
    expect(replyBox(container)!.value).toBe(
      '请补充相关截图（回复时可以直接附图），方便进一步核对。'
    )

    await act(async () => {
      findButton(container, '发送')!.click()
    })
    await flush()
    expect(mocks.kunFetchPost).toHaveBeenCalledWith('/case/9/message', {
      content: '请补充相关截图（回复时可以直接附图），方便进一步核对。',
      imageKeys: []
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
    expect(container.querySelector('[role="alertdialog"]')).toBeNull()

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
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull()

    // 取消不写请求
    await act(async () => {
      findButton(container, '取消')!.click()
    })
    expect(mocks.kunFetchPost).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alertdialog"]')).toBeNull()

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
        canWithdraw: false,
        canConfirm: false,
        canReview: false,
        canPropose: false,
        canHideResource: false,
        canRestoreResource: false,
        canMoveResource: false,
        canHandleContent: false,
        canConfirmUserHandled: false,
        canHideMessages: false,
        allowedContentActions: [],
        allowedResolutions: []
      }
    })
    mocks.kunFetchGet.mockResolvedValue(detailResponse(detail))
    mocks.kunFetchPost.mockResolvedValue({ case: detail, changed: true })
    const container = await mount(<IssueCaseDetail caseId={9} />)
    await flush()

    const text = container.textContent ?? ''
    expect(text).toContain('处理结果：无法复现')
    expect(text).toContain('问题仍未解决？')
    // 重开窗口由服务端 canReopen 决定，这里只把剩余时间读出来
    // 还剩 4 天 2 小时：剩余时间向上取整，与到期提醒同一口径
    expect(text).toContain('结案后 7 天内可以重新打开一次，还剩约 5 天')
    // 已结案：回复框关闭并说明原因
    expect(replyBox(container)).toBeNull()
    expect(text).toContain('该问题已结案，无法继续回复')

    await act(async () => {
      findButton(container, '重新打开')!.click()
    })
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull()
    // D19：重开必须写理由，没写时确认按钮不可用
    expect(findButton(container, '确认')!.disabled).toBe(true)
    await typeInto(container, '#issue-action-reason', '换了网盘仍然缺少补丁')
    await act(async () => {
      findButton(container, '确认')!.click()
    })
    await flush()
    expect(mocks.kunFetchPost).toHaveBeenCalledWith('/case/9/reopen', {
      content: '换了网盘仍然缺少补丁'
    })
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
    const container = await mount(<IssueCaseDetail caseId={9} />)
    await flush()

    const text = container.textContent ?? ''
    expect(text).toContain('你已提交过同类举报')
    // 关注者视角不给等待时长／升级倒计时
    expect(text).not.toContain('发布者处理中，约')
    expect(text).not.toContain('已等待')
    // subscriberCount 为 null 时不显示人数
    expect(text).not.toContain('人报告')
    // 无对话、无回复框、无重开入口
    expect(container.querySelector('[aria-label="沟通记录"]')).toBeNull()
    expect(text).toContain('暂无沟通记录')
    expect(replyBox(container)).toBeNull()
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
        canWithdraw: false,
        canConfirm: false,
        canReview: false,
        canPropose: false,
        canHideResource: false,
        canRestoreResource: false,
        canMoveResource: false,
        canHandleContent: false,
        canConfirmUserHandled: false,
        canHideMessages: false,
        allowedContentActions: [],
        allowedResolutions: ['repaired', 'unreproducible', 'out_of_scope']
      }
    })
    mocks.kunFetchGet.mockResolvedValue(detailResponse(detail))
    const container = await mount(<IssueCaseDetail caseId={9} />)
    await flush()

    // 不显示发布者专用结案表单，也不给处理方快捷回复
    expect(container.querySelector('select[aria-label="处理结论"]')).toBeNull()
    expect(findButton(container, '结案')).toBeUndefined()
    expect(findButton(container, '需要截图')).toBeUndefined()
    // 站方改为后台入口
    const entry = container.querySelector('a[href="/dashboard/case/9"]')
    expect(entry).not.toBeNull()
    expect(entry!.textContent).toContain('在后台处理')
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
        canWithdraw: false,
        canConfirm: false,
        canReview: false,
        canPropose: false,
        canHideResource: false,
        canRestoreResource: false,
        canMoveResource: false,
        canHandleContent: false,
        canConfirmUserHandled: false,
        canHideMessages: false,
        allowedContentActions: [],
        allowedResolutions: []
      }
    })
    mocks.kunFetchGet.mockResolvedValue(detailResponse(detail))
    mocks.kunFetchPost.mockResolvedValueOnce({
      conflict: true,
      existingCaseId: 77
    })
    const container = await mount(<IssueCaseDetail caseId={9} />)
    await flush()

    await act(async () => {
      findButton(container, '重新打开')!.click()
    })
    await typeInto(container, '#issue-action-reason', '仍然无法下载')
    await act(async () => {
      findButton(container, '确认')!.click()
    })
    await flush()

    // 冲突：只展示，不自动提交/关注
    expect(container.textContent).toContain('该目标已有一条正在处理的同类问题')
    expect(mocks.kunFetchPost).toHaveBeenCalledTimes(1)
    expect(mocks.kunFetchPost).toHaveBeenLastCalledWith('/case/9/reopen', {
      content: '仍然无法下载'
    })
    expect(mocks.routerPush).not.toHaveBeenCalled()

    // 说明不足时拦截
    const subscribeButton = findButton(container, '提交并关注现有问题')!
    expect(subscribeButton.disabled).toBe(true)
    const conflictBox = () =>
      container.querySelector<HTMLTextAreaElement>('#issue-reopen-content')!
    await act(async () => {
      const textarea = conflictBox()
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
    expect(conflictBox().value).toBe('我这边仍然存在问题，仍然无法下载')
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

  it('shows images and signs later reporter notes as other reporters (D11, D15)', async () => {
    mocks.user = { uid: 5, name: '报告者乙', role: 1 }
    mocks.kunFetchGet.mockResolvedValue(
      detailResponse(
        makeDetail({
          reporter: { id: 5, name: '报告者乙', avatar: '' },
          messages: [
            {
              id: 1,
              kind: 'reply',
              event: null,
              body: '缺少第二分卷',
              author: { id: 5, name: '报告者乙', avatar: '' },
              payload: null,
              images: ['https://img.example/case/5/a.avif'],
              created: '2026-09-13T00:00:00.000Z'
            },
            {
              id: 2,
              kind: 'report',
              event: null,
              body: '我这边也缺',
              author: { id: 8, name: '后来者丙', avatar: '' },
              payload: null,
              created: '2026-09-13T01:00:00.000Z'
            }
          ]
        })
      )
    )
    const container = await mount(<IssueCaseDetail caseId={9} />)
    await flush()

    const text = container.textContent ?? ''
    expect(text).toContain('后来者丙')
    expect(text).toContain('其他报告者')
    expect(
      container
        .querySelector('img[src="https://img.example/case/5/a.avif"]')
        ?.getAttribute('alt')
    ).toContain('附图 1')
    // 对象名直达资源所在的游戏页（D22）
    expect(
      [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'))
    ).toContain('/abc?tab=resources&resourceSection=galgame&resourceId=7')
  })

  it('signs handler-side replies by who wrote them (M03-9)', async () => {
    mocks.user = { uid: 5, name: '报告者乙', role: 1 }
    mocks.kunFetchGet.mockResolvedValue(
      detailResponse(
        makeDetail({
          ownerType: 'staff',
          escalatedAt: '2026-09-14T00:00:00.000Z',
          reporter: { id: 5, name: '报告者乙', avatar: '' },
          messages: [
            {
              id: 1,
              kind: 'reply',
              event: null,
              body: '缺少第二分卷',
              author: { id: 5, name: '报告者乙', avatar: '' },
              payload: null,
              created: '2026-09-13T00:00:00.000Z'
            },
            {
              id: 2,
              kind: 'reply',
              event: null,
              body: '已重新上传第二分卷',
              author: { id: 2, name: '发布者甲', avatar: '' },
              authorSide: 'original-publisher',
              payload: null,
              created: '2026-09-14T01:00:00.000Z'
            },
            {
              id: 3,
              kind: 'reply',
              event: null,
              body: '请重新下载核对',
              author: { id: 1, name: '站长', avatar: '' },
              authorSide: 'staff',
              payload: null,
              created: '2026-09-14T02:00:00.000Z'
            }
          ]
        })
      )
    )
    const container = await mount(<IssueCaseDetail caseId={9} />)
    await flush()

    const rows = [
      ...container.querySelectorAll('ol[aria-label="沟通记录"] > li')
    ].map((row) => row.textContent ?? '')
    expect(rows[0]).toContain('报告者')
    expect(rows[1]).toContain('原发布者')
    expect(rows[2]).toContain('网站管理员')
    expect(rows.slice(1).some((row) => row.includes('处理方'))).toBe(false)
  })

  it('shows a hidden note as its placeholder and links guide paths (D27, item 20)', async () => {
    mocks.user = { uid: 5, name: '报告者乙', role: 1 }
    mocks.kunFetchGet.mockResolvedValue(
      detailResponse(
        makeDetail({
          reporter: { id: 5, name: '报告者乙', avatar: '' },
          messages: [
            {
              id: 1,
              kind: 'reply',
              event: null,
              body: '解压失败请先看 /doc/notice/repair-rar',
              author: { id: 2, name: '发布者甲', avatar: '' },
              payload: null,
              created: '2026-09-13T00:00:00.000Z'
            },
            {
              id: 2,
              kind: 'report',
              event: null,
              body: '该内容已被网站管理员隐藏。',
              author: { id: 8, name: '后来者丙', avatar: '' },
              hidden: true,
              created: '2026-09-13T01:00:00.000Z'
            }
          ]
        })
      )
    )
    const container = await mount(<IssueCaseDetail caseId={9} />)
    await flush()

    const guide = [...container.querySelectorAll('a')].find(
      (link) => link.getAttribute('href') === '/doc/notice/repair-rar'
    )
    expect(guide?.textContent).toBe('/doc/notice/repair-rar')
    expect(guide?.getAttribute('target')).toBe('_blank')
    const placeholder = [...container.querySelectorAll('span')].find(
      (span) => span.textContent === '该内容已被网站管理员隐藏。'
    )
    expect(placeholder?.className).toContain('italic')
  })

  it('opener withdraws through a confirmation (D18)', async () => {
    mocks.user = { uid: 5, name: '报告者乙', role: 1 }
    const detail = makeDetail({
      capabilities: capabilities({ canReply: true, canWithdraw: true })
    })
    mocks.kunFetchGet.mockResolvedValue(detailResponse(detail))
    mocks.kunFetchPost.mockResolvedValue({
      case: { ...detail, status: 'resolved' },
      changed: true
    })
    const container = await mount(<IssueCaseDetail caseId={9} />)
    await flush()

    await act(async () => {
      findButton(container, '撤回')!.click()
    })
    expect(container.textContent).toContain('开启者撤回')
    expect(mocks.kunFetchPost).not.toHaveBeenCalled()
    await act(async () => {
      findButton(container, '确认')!.click()
    })
    await flush()
    expect(mocks.kunFetchPost).toHaveBeenCalledWith('/case/9/withdraw', {})
    expect(mocks.toast.success).toHaveBeenCalledWith('已撤回，问题已结束')
  })

  it('records「没解决」and moves straight on to the review request (D16, D19)', async () => {
    mocks.user = { uid: 5, name: '报告者乙', role: 1 }
    const detail = makeDetail({
      status: 'resolved',
      resolution: 'unreproducible',
      reopenedCount: 1,
      closedAt: '2026-09-13T02:00:00.000Z',
      capabilities: capabilities({ canConfirm: true, canReview: true })
    })
    mocks.kunFetchGet.mockResolvedValue(detailResponse(detail))
    mocks.kunFetchPost.mockResolvedValue({ case: detail, changed: true })
    const container = await mount(<IssueCaseDetail caseId={9} />)
    await flush()

    expect(container.textContent).toContain('问题解决了吗？')
    expect(container.textContent).toContain('没解决可以请网站管理员复核')
    await act(async () => {
      findButton(container, '没解决')!.click()
    })
    await flush()
    expect(mocks.kunFetchPost).toHaveBeenCalledWith('/case/9/confirm', {
      solved: false
    })
    // 接着打开复核，理由必填
    expect(container.textContent).toContain('网站管理员的结论是最终结果')
    expect(findButton(container, '确认')!.disabled).toBe(true)
    await typeInto(container, '#issue-action-reason', '发布者没有核对第二分卷')
    await act(async () => {
      findButton(container, '确认')!.click()
    })
    await flush()
    expect(mocks.kunFetchPost).toHaveBeenLastCalledWith('/case/9/review', {
      content: '发布者没有核对第二分卷'
    })
  })

  it('records「解决了」without opening anything else', async () => {
    mocks.user = { uid: 5, name: '报告者乙', role: 1 }
    const detail = makeDetail({
      status: 'resolved',
      resolution: 'repaired',
      closedAt: '2026-09-13T02:00:00.000Z',
      capabilities: capabilities({ canConfirm: true, canReopen: true })
    })
    mocks.kunFetchGet.mockResolvedValue(detailResponse(detail))
    mocks.kunFetchPost.mockResolvedValue({ case: detail, changed: true })
    const container = await mount(<IssueCaseDetail caseId={9} />)
    await flush()

    await act(async () => {
      findButton(container, '解决了')!.click()
    })
    await flush()
    expect(mocks.kunFetchPost).toHaveBeenCalledWith('/case/9/confirm', {
      solved: true
    })
    expect(container.querySelector('[role="alertdialog"]')).toBeNull()
  })

  it('lets the handed-off publisher reply and propose a closure (D20)', async () => {
    const detail = makeDetail({
      ownerType: 'staff',
      escalatedAt: '2026-09-14T00:00:00.000Z',
      capabilities: capabilities({ canReply: true, canPropose: true })
    })
    mocks.kunFetchGet.mockResolvedValue(detailResponse(detail))
    mocks.kunFetchPost.mockResolvedValue({ case: detail, changed: true })
    const container = await mount(<IssueCaseDetail caseId={9} />)
    await flush()

    const text = container.textContent ?? ''
    expect(text).toContain('已交给网站管理员')
    expect(text).toContain('处理方：网站管理员')
    expect(container.textContent).toContain('去修改资源')
    // 不能自己结案，只能提请
    expect(
      [...container.querySelectorAll('button')].some(
        (button) => button.textContent === '结案'
      )
    ).toBe(false)

    await chooseResolution(container, 'repaired')
    expect(findButton(container, '提请结案')!.disabled).toBe(true)
    await typeInto(
      container,
      'textarea[aria-label="提请说明"]',
      '已重新上传第二分卷'
    )
    await act(async () => {
      findButton(container, '提请结案')!.click()
    })
    expect(container.textContent).toContain('网站管理员确认后才会结案')
    await act(async () => {
      findButton(container, '确认')!.click()
    })
    await flush()
    expect(mocks.kunFetchPost).toHaveBeenCalledWith('/case/9/propose', {
      resolution: 'repaired',
      content: '已重新上传第二分卷'
    })
  })

  it('asks the publisher for a note before closing as unreproducible (D16)', async () => {
    const detail = makeDetail({
      owner: { id: 2, name: '发布者甲', avatar: '' },
      capabilities: capabilities({
        canReply: true,
        canResolve: true,
        allowedResolutions: ['repaired', 'unreproducible', 'out_of_scope']
      })
    })
    mocks.kunFetchGet.mockResolvedValue(detailResponse(detail))
    const container = await mount(<IssueCaseDetail caseId={9} />)
    await flush()

    await chooseResolution(container, 'unreproducible')
    expect(container.textContent).toContain('请写明核对了什么')
    await act(async () => {
      findButton(container, '结案')!.click()
    })
    expect(container.querySelector('[role="alertdialog"]')).toBeNull()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      '以「无法复现」结案时请写明核对了什么'
    )
  })

  it('does not present the last round result on a reopened case', async () => {
    mocks.user = { uid: 5, name: '报告者乙', role: 1 }
    mocks.kunFetchGet.mockResolvedValue(
      detailResponse(
        makeDetail({
          status: 'open',
          resolution: 'unreproducible',
          reopenedCount: 1,
          closedAt: '2026-09-13T02:00:00.000Z',
          capabilities: capabilities({ canReply: true, canWithdraw: true })
        })
      )
    )
    const container = await mount(<IssueCaseDetail caseId={9} />)
    await flush()

    const text = container.textContent ?? ''
    expect(text).not.toContain('处理结果')
    expect(text).not.toContain('无法复现')
  })
})
