import React, { act } from 'react'
import type { Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
  kunFetchGet: vi.fn(),
  kunFetchPost: vi.fn(),
  user: { uid: 100, name: 'Tester', role: 1 }
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
    Chip: ({ children }: { children?: React.ReactNode }) => (
      <span>{children}</span>
    ),
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
    SelectItem: () => null,
    RadioGroup: ({
      children,
      value,
      onValueChange,
      'aria-label': ariaLabel
    }: {
      children?: React.ReactNode
      value?: string
      onValueChange?: (value: string) => void
      'aria-label'?: string
    }) => (
      <div role="radiogroup" aria-label={ariaLabel}>
        {toArray(children).map((child) => {
          const props = child.props as {
            value: string
            children?: React.ReactNode
          }
          return (
            <label key={props.value}>
              <input
                type="radio"
                checked={value === props.value}
                value={props.value}
                onChange={() => onValueChange?.(props.value)}
              />
              {props.children}
            </label>
          )
        })}
      </div>
    ),
    Radio: () => null,
    Tooltip: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    useDisclosure: () => {
      const [isOpen, setIsOpen] = R.useState(false)
      return {
        isOpen,
        onOpen: () => setIsOpen(true),
        onClose: () => setIsOpen(false),
        onOpenChange: setIsOpen
      }
    }
  }
})

import { ReportResourceButton } from '~/components/case/ReportResourceButton'
import { ReportUserButton } from '~/components/case/ReportUserButton'
import { FeedbackButton } from '~/components/patch/header/button/FeedbackButton'
import type { PatchResource } from '~/types/api/patch'

globalThis.React = React

const resource = {
  id: 7,
  name: '资源X',
  section: 'galgame',
  patchId: 1,
  user: { id: 2, name: '发布者', avatar: '', role: 1 }
} as unknown as PatchResource

const patch = { id: 1, uniqueId: 'abc', name: '条目A' } as never

const flush = async () => {
  await act(async () => {})
}

const findButton = (container: HTMLElement, text: string) =>
  [...container.querySelectorAll('button')].find((button) =>
    button.textContent?.includes(text)
  )

describe('case entry buttons', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.user = { uid: 100, name: 'Tester', role: 1 }
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

  // React 受控组件：直接赋值会被 value tracker 忽略，需要 native setter + input 事件
  const setNativeValue = (
    element: HTMLTextAreaElement | HTMLSelectElement,
    value: string,
    event: 'input' | 'change'
  ) => {
    const prototype =
      element instanceof dom!.window.HTMLSelectElement
        ? dom!.window.HTMLSelectElement.prototype
        : dom!.window.HTMLTextAreaElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(
      element,
      value
    )
    element.dispatchEvent(new dom!.window.Event(event, { bubbles: true }))
  }

  const setTextarea = async (
    container: HTMLElement,
    label: string,
    value: string
  ) => {
    const textarea = container.querySelector<HTMLTextAreaElement>(
      `textarea[aria-label="${label}"]`
    )!
    await act(async () => {
      setNativeValue(textarea, value, 'input')
    })
  }

  it('hides report entries for anonymous users', async () => {
    mocks.user = { uid: 0, name: '', role: 0 }
    const container = await mount(
      <ReportResourceButton resource={resource} patchId={1} />
    )
    expect(container.querySelector('button')).toBeNull()
  })

  it('submits resource mismatch with expectedPatchId and closes on created', async () => {
    mocks.kunFetchPost.mockResolvedValue({
      case: { id: 5 },
      created: true,
      subscribed: false
    })
    const container = await mount(
      <ReportResourceButton resource={resource} patchId={1} />
    )

    await act(async () => {
      findButton(container, '报告问题')!.click()
    })
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()

    // 字数不足时禁用提交
    await setTextarea(container, '问题描述', '太短')
    expect(findButton(container, '提交')!.disabled).toBe(true)

    await setTextarea(container, '问题描述', '实际内容与描述不符，缺文件')
    const submit = findButton(container, '提交')!
    expect(submit.disabled).toBe(false)
    await act(async () => {
      submit.click()
    })
    await flush()

    expect(mocks.kunFetchPost).toHaveBeenCalledWith('/case', {
      kind: 'resource_mismatch',
      targetType: 'resource',
      targetId: 7,
      expectedPatchId: 1,
      content: '实际内容与描述不符，缺文件'
    })
    expect(mocks.toast.success).toHaveBeenCalledWith(
      '已提交，可在「问题处理」页跟进进度'
    )
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('shows dedup notice on subscribed and keeps dialog on business error', async () => {
    mocks.kunFetchPost.mockResolvedValue({
      case: { id: 5 },
      created: false,
      subscribed: true
    })
    const container = await mount(
      <ReportResourceButton resource={resource} patchId={1} />
    )
    await act(async () => {
      findButton(container, '报告问题')!.click()
    })
    await setTextarea(container, '问题描述', '实际内容与描述不符，缺文件')
    await act(async () => {
      findButton(container, '提交')!.click()
    })
    await flush()
    expect(mocks.toast.success).toHaveBeenCalledWith(
      '该资源已有相同问题正在处理，已为你登记关注'
    )

    // 业务错误（字符串）保留输入并保持弹窗
    mocks.kunFetchPost.mockResolvedValue('同一资源每天最多提交一次')
    await act(async () => {
      findButton(container, '报告问题')!.click()
    })
    await setTextarea(container, '问题描述', '再次尝试提交同资源问题')
    await act(async () => {
      findButton(container, '提交')!.click()
    })
    await flush()
    expect(mocks.toast.error).toHaveBeenCalledWith('同一资源每天最多提交一次')
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    expect(
      container.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="问题描述"]'
      )!.value
    ).toBe('再次尝试提交同资源问题')

    // 网络错误同样保留输入并释放 loading
    mocks.kunFetchPost.mockRejectedValue(new Error('network'))
    await act(async () => {
      findButton(container, '提交')!.click()
    })
    await flush()
    expect(mocks.toast.error).toHaveBeenCalledWith('网络错误，提交失败，请重试')
    expect(findButton(container, '提交')!.disabled).toBe(false)
  })

  it('submits user report as content_violation and hides on own profile', async () => {
    const own = await mount(
      <ReportUserButton targetUserId={100} targetUserName="Tester" />
    )
    expect(own.querySelector('button')).toBeNull()
    own.ownerDocument.body.innerHTML = ''

    mocks.kunFetchPost.mockResolvedValue({
      case: { id: 6 },
      created: true,
      subscribed: false
    })
    const container = await mount(
      <ReportUserButton targetUserId={200} targetUserName="某人" />
    )
    await act(async () => {
      findButton(container, '举报')!.click()
    })
    await setTextarea(container, '举报原因', '违规内容')
    await act(async () => {
      findButton(container, '提交')!.click()
    })
    await flush()
    expect(mocks.kunFetchPost).toHaveBeenCalledWith('/case', {
      kind: 'content_violation',
      targetType: 'user',
      targetId: 200,
      content: '违规内容'
    })
  })

  it('FeedbackButton guides patch-info without submission and posts other/wrong-patch cases', async () => {
    mocks.kunFetchGet.mockResolvedValue([resource])
    mocks.kunFetchPost.mockResolvedValue({
      case: { id: 8 },
      created: true,
      subscribed: false
    })
    const container = await mount(<FeedbackButton patch={patch} />)

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="游戏反馈"]')!
        .click()
    })
    // 默认选项「条目资料有误」只有引导文案，没有提交按钮
    expect(container.textContent).toContain('条目资料有误')
    expect(findButton(container, '提交')).toBeUndefined()
    expect(mocks.kunFetchPost).not.toHaveBeenCalled()

    // 「其他」直接创建 other × patch
    const radios = container.querySelectorAll<HTMLInputElement>(
      'input[type="radio"]'
    )
    const otherRadio = [...radios].find((radio) => radio.value === 'other')!
    await act(async () => {
      otherRadio.click()
    })
    await setTextarea(container, '问题描述', '条目相关的其他问题描述')
    await act(async () => {
      findButton(container, '提交')!.click()
    })
    await flush()
    expect(mocks.kunFetchPost).toHaveBeenCalledWith('/case', {
      kind: 'other',
      targetType: 'patch',
      targetId: 1,
      content: '条目相关的其他问题描述'
    })

    // 「资源发错条目」按需拉取资源列表并创建 resource_wrong_patch
    // 上一次提交成功已关闭弹窗，重新打开并选择该选项
    mocks.kunFetchPost.mockClear()
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="游戏反馈"]')!
        .click()
    })
    const wrongPatchRadio = [
      ...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')
    ].find((radio) => radio.value === 'resource_wrong_patch')!
    await act(async () => {
      wrongPatchRadio.click()
    })
    await flush()
    expect(mocks.kunFetchGet).toHaveBeenCalledWith('/patch/resource', {
      patchId: 1
    })

    const select = container.querySelector<HTMLSelectElement>(
      'select[aria-label="选择资源"]'
    )!
    await act(async () => {
      setNativeValue(select, '7', 'change')
    })
    await setTextarea(container, '问题描述', '这个资源不属于该条目')
    await act(async () => {
      findButton(container, '提交')!.click()
    })
    await flush()
    expect(mocks.kunFetchPost).toHaveBeenCalledWith('/case', {
      kind: 'resource_wrong_patch',
      targetType: 'resource',
      targetId: 7,
      expectedPatchId: 1,
      content: '这个资源不属于该条目'
    })
  })

  it('UI2: idempotent success (created=false, subscribed=false) still confirms and closes', async () => {
    mocks.kunFetchPost.mockResolvedValue({
      case: { id: 5 },
      created: false,
      subscribed: false
    })
    const container = await mount(
      <ReportResourceButton resource={resource} patchId={1} />
    )
    await act(async () => {
      findButton(container, '报告问题')!.click()
    })
    await setTextarea(container, '问题描述', '实际内容与描述不符，缺文件')
    await act(async () => {
      findButton(container, '提交')!.click()
    })
    await flush()
    expect(mocks.toast.success).toHaveBeenCalledWith('已登记，正在处理')
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    // 已收起清空：再次打开是空表单
    await act(async () => {
      findButton(container, '报告问题')!.click()
    })
    expect(
      container.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="问题描述"]'
      )!.value
    ).toBe('')
  })

  it('UI3: entries show expected first-response hints', async () => {
    const resourceContainer = await mount(
      <ReportResourceButton resource={resource} patchId={1} />
    )
    await act(async () => {
      findButton(resourceContainer, '报告问题')!.click()
    })
    expect(resourceContainer.textContent).toContain('预计首次响应在 7 天内')
    act(() => {
      root?.unmount()
    })

    const userContainer = await mount(
      <ReportUserButton targetUserId={200} targetUserName="某人" />
    )
    await act(async () => {
      findButton(userContainer, '举报')!.click()
    })
    expect(userContainer.textContent).toContain('预计首次响应在 3 天内')
    act(() => {
      root?.unmount()
    })

    mocks.kunFetchGet.mockResolvedValue([resource])
    const feedbackContainer = await mount(<FeedbackButton patch={patch} />)
    await act(async () => {
      feedbackContainer
        .querySelector<HTMLButtonElement>('button[aria-label="游戏反馈"]')!
        .click()
    })
    const wrongPatchRadio = [
      ...feedbackContainer.querySelectorAll<HTMLInputElement>(
        'input[type="radio"]'
      )
    ].find((radio) => radio.value === 'resource_wrong_patch')!
    await act(async () => {
      wrongPatchRadio.click()
    })
    expect(feedbackContainer.textContent).toContain('预计首次响应在 7 天内')
    // 「其他」不承诺时限
    const otherRadio = [
      ...feedbackContainer.querySelectorAll<HTMLInputElement>(
        'input[type="radio"]'
      )
    ].find((radio) => radio.value === 'other')!
    await act(async () => {
      otherRadio.click()
    })
    expect(feedbackContainer.textContent).not.toContain('预计首次响应')
  })
})
