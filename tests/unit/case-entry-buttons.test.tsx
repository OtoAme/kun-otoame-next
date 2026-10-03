import React, { act } from 'react'
import type { Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
  kunFetchPost: vi.fn(),
  kunFetchFormData: vi.fn(),
  user: { uid: 100, name: 'Tester', role: 1 }
}))

vi.mock('react-hot-toast', () => ({ default: mocks.toast }))
vi.mock('~/utils/kunFetch', () => ({
  kunFetchPost: mocks.kunFetchPost,
  kunFetchFormData: mocks.kunFetchFormData
}))
vi.mock('~/store/userStore', () => ({
  useUserStore: (selector: (state: { user: typeof mocks.user }) => unknown) =>
    selector({ user: mocks.user })
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

vi.mock('@heroui/react', async () => {
  const R = await import('react')
  const toArray = (children: React.ReactNode): React.ReactElement[] =>
    (Array.isArray(children) ? children.flat() : [children]).filter(
      (child): child is React.ReactElement => R.isValidElement(child)
    )
  return {
    Button: ({
      children,
      onPress,
      isDisabled,
      isLoading,
      href,
      'aria-label': ariaLabel
    }: {
      children?: React.ReactNode
      onPress?: () => void
      isDisabled?: boolean
      isLoading?: boolean
      href?: string
      'aria-label'?: string
    }) =>
      href ? (
        <a href={href} aria-label={ariaLabel}>
          {children}
        </a>
      ) : (
        <button
          aria-label={ariaLabel}
          disabled={isDisabled || isLoading}
          onClick={onPress}
        >
          {children}
        </button>
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
            description?: string
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
              {props.description ? <small>{props.description}</small> : null}
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

const officialResource = {
  ...resource,
  user: { id: 3, name: '管理员', avatar: '', role: 3 }
} as unknown as PatchResource

const patch = { id: 1, uniqueId: 'abc', name: '条目A' } as never

const created = (id: number, overrides: Record<string, unknown> = {}) => ({
  case: { id, public: true, subscriberCount: 1 },
  created: true,
  subscribed: false,
  ...overrides
})

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
    act(() => {
      root?.unmount()
    })
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
  const setTextarea = async (
    container: HTMLElement,
    label: string,
    value: string
  ) => {
    const textarea = container.querySelector<HTMLTextAreaElement>(
      `textarea[aria-label="${label}"]`
    )!
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        dom!.window.HTMLTextAreaElement.prototype,
        'value'
      )!.set!.call(textarea, value)
      textarea.dispatchEvent(new dom!.window.Event('input', { bubbles: true }))
    })
  }

  const pickRadio = async (container: HTMLElement, value: string) => {
    const radio = [
      ...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')
    ].find((candidate) => candidate.value === value)!
    await act(async () => {
      radio.click()
    })
  }

  const openResourceReport = async (container: HTMLElement) => {
    await act(async () => {
      findButton(container, '报告问题')!.click()
    })
  }

  describe('resource card「报告问题」(D17)', () => {
    it('shows guests the entry, answers guide phenomena and asks them to log in before a case', async () => {
      mocks.user = { uid: 0, name: '', role: 0 }
      const container = await mount(
        <ReportResourceButton resource={resource} patchId={1} />
      )
      await openResourceReport(container)

      // 现象即选项，下面附例子；05 的违规现象已登记但不显示
      const text = container.textContent ?? ''
      expect(text).toContain('资源与描述不符')
      expect(text).toContain('链接失效')
      expect(text).toContain('网盘显示已删除或已过期')
      expect(text).toContain('发在了错误的条目下')
      expect(text).not.toContain('疑似违规或有害内容')

      // 分流：下载慢只给指南，不产生事项
      await pickRadio(container, 'download_slow')
      expect(
        container.querySelector('a[href="/doc/notice/download"]')
      ).not.toBeNull()
      expect(findButton(container, '提交')).toBeUndefined()

      // 需要建事项的现象：访客在点击提交时被引导登录，不先写说明
      await pickRadio(container, 'resource_mismatch')
      expect(
        container.querySelector('textarea[aria-label="问题描述"]')
      ).toBeNull()
      await act(async () => {
        findButton(container, '登录后提交')!.click()
      })
      expect(container.textContent).toContain('报告问题需要先登录账号')
      expect(container.querySelector('a[href="/login"]')).not.toBeNull()
      expect(mocks.kunFetchPost).not.toHaveBeenCalled()
    })

    it('tells resource requests to wait for the help board', async () => {
      const container = await mount(
        <ReportResourceButton resource={resource} patchId={1} />
      )
      await openResourceReport(container)

      await pickRadio(container, 'request_resource')
      expect(container.textContent).toContain('等待求助区建成')
      expect(
        container.querySelector('a[href="/doc/notice/contribute"]')?.textContent
      ).toBe('内容贡献指南')
      expect(findButton(container, '提交')).toBeUndefined()

      // 其他指南现象仍用通用说明
      await pickRadio(container, 'download_slow')
      expect(container.textContent).toContain('这类问题不需要提交')
      expect(container.textContent).not.toContain('等待求助区建成')
    })

    it('submits the chosen phenomenon and switches to a result with a direct link', async () => {
      mocks.kunFetchPost.mockResolvedValue(created(5))
      const container = await mount(
        <ReportResourceButton resource={resource} patchId={1} />
      )
      await openResourceReport(container)
      await pickRadio(container, 'resource_mismatch')

      // D15 身份告知与处理方、首次响应提示
      const text = container.textContent ?? ''
      expect(text).toContain('发布者能看到你的用户名和说明')
      expect(text).toContain('该问题先由资源发布者处理，预计首次响应在 7 天内')
      expect(
        container
          .querySelector('textarea[aria-label="问题描述"]')
          ?.getAttribute('placeholder')
      ).toBe('描述里写的是……，实际拿到的是……')

      // 字数不足时禁用提交
      await setTextarea(container, '问题描述', '太短')
      expect(findButton(container, '提交')!.disabled).toBe(true)
      await setTextarea(container, '问题描述', '实际内容与描述不符，缺文件')
      await act(async () => {
        findButton(container, '提交')!.click()
      })
      await flush()

      expect(mocks.kunFetchPost).toHaveBeenCalledWith('/case', {
        kind: 'resource_mismatch',
        targetType: 'resource',
        targetId: 7,
        expectedPatchId: 1,
        content: '实际内容与描述不符，缺文件',
        imageKeys: []
      })
      expect(mocks.toast.success).not.toHaveBeenCalled()
      expect(container.textContent).toContain(
        '已交给资源发布者，预计 7 天内首次回应'
      )
      expect(
        container.querySelector('a[href="/issue/5"]')?.textContent
      ).toContain('查看这条问题')

      // 关闭后清空：再次打开是空表单
      await act(async () => {
        findButton(container, '关闭')!.click()
      })
      await openResourceReport(container)
      expect(
        container.querySelector('textarea[aria-label="问题描述"]')
      ).toBeNull()
      await pickRadio(container, 'resource_mismatch')
      expect(
        container.querySelector<HTMLTextAreaElement>(
          'textarea[aria-label="问题描述"]'
        )!.value
      ).toBe('')
    })

    it('files link failures as their own interim kind and names the admin on official resources', async () => {
      mocks.kunFetchPost.mockResolvedValue(created(6))
      const container = await mount(
        <ReportResourceButton resource={officialResource} patchId={1} />
      )
      await openResourceReport(container)
      await pickRadio(container, 'link_failure')

      expect(container.textContent).toContain(
        '该问题由网站管理员处理，预计首次响应在 7 天内'
      )
      expect(container.textContent).toContain(
        '网站管理员能看到你的用户名和说明'
      )
      await setTextarea(container, '问题描述', '第二条百度网盘链接显示已过期')
      await act(async () => {
        findButton(container, '提交')!.click()
      })
      await flush()
      expect(mocks.kunFetchPost).toHaveBeenCalledWith(
        '/case',
        expect.objectContaining({ kind: 'resource_link_failure' })
      )
      expect(container.textContent).toContain('已交给网站管理员')
    })

    it('files a wrong-patch resource straight to the site administrator (M03-9)', async () => {
      mocks.kunFetchPost.mockResolvedValue(
        created(10, { case: { id: 10, public: false, subscriberCount: null } })
      )
      const container = await mount(
        <ReportResourceButton resource={resource} patchId={1} />
      )
      await openResourceReport(container)
      await pickRadio(container, 'wrong_patch')

      // 普通发布者的资源也不经发布者
      const text = container.textContent ?? ''
      expect(text).toContain('该问题由网站管理员处理，预计首次响应在 7 天内')
      expect(text).toContain('网站管理员能看到你的用户名和说明')
      expect(text).not.toContain('资源发布者')
      expect(
        container
          .querySelector('textarea[aria-label="问题描述"]')
          ?.getAttribute('placeholder')
      ).toBe('这条资源实际属于哪个游戏（游戏名或条目链接）……')
      await setTextarea(container, '问题描述', '这是条目B的汉化补丁，不属于这里')
      await act(async () => {
        findButton(container, '提交')!.click()
      })
      await flush()
      expect(mocks.kunFetchPost).toHaveBeenCalledWith('/case', {
        kind: 'resource_wrong_patch',
        targetType: 'resource',
        targetId: 7,
        expectedPatchId: 1,
        content: '这是条目B的汉化补丁，不属于这里',
        imageKeys: []
      })
      expect(container.textContent).toContain(
        '已交给网站管理员，预计 7 天内首次回应'
      )
    })

    it('uploads images and sends their keys with the report (D11)', async () => {
      mocks.kunFetchFormData.mockResolvedValue({
        key: 'case/100/1-a.avif',
        url: 'https://img.example/case/100/1-a.avif'
      })
      mocks.kunFetchPost.mockResolvedValue(created(7))
      const container = await mount(
        <ReportResourceButton resource={resource} patchId={1} />
      )
      await openResourceReport(container)
      await pickRadio(container, 'resource_mismatch')

      const input =
        container.querySelector<HTMLInputElement>('input[type="file"]')!
      const file = new dom!.window.File(['x'], 'shot.png', {
        type: 'image/png'
      })
      Object.defineProperty(input, 'files', { value: [file] })
      await act(async () => {
        input.dispatchEvent(new dom!.window.Event('change', { bubbles: true }))
      })
      await flush()
      expect(mocks.kunFetchFormData).toHaveBeenCalledWith(
        '/case/image',
        expect.anything()
      )
      expect(
        container.querySelector(
          'img[src="https://img.example/case/100/1-a.avif"]'
        )
      ).not.toBeNull()

      await setTextarea(container, '问题描述', '实际内容与描述不符，缺文件')
      await act(async () => {
        findButton(container, '提交')!.click()
      })
      await flush()
      expect(mocks.kunFetchPost).toHaveBeenCalledWith(
        '/case',
        expect.objectContaining({ imageKeys: ['case/100/1-a.avif'] })
      )
    })

    it('says how many reported on a dedup hit and keeps the draft on errors', async () => {
      mocks.kunFetchPost.mockResolvedValue({
        case: { id: 5, public: true, subscriberCount: 3 },
        created: false,
        subscribed: true
      })
      const container = await mount(
        <ReportResourceButton resource={resource} patchId={1} />
      )
      await openResourceReport(container)
      await pickRadio(container, 'resource_mismatch')
      await setTextarea(container, '问题描述', '实际内容与描述不符，缺文件')
      await act(async () => {
        findButton(container, '提交')!.click()
      })
      await flush()
      expect(container.textContent).toContain('已为你登记关注')
      expect(container.textContent).toContain('已有 3 人报告')

      // 业务错误（字符串）保留输入并保持表单
      await act(async () => {
        findButton(container, '关闭')!.click()
      })
      mocks.kunFetchPost.mockResolvedValue('您今天已经提交过该资源的问题')
      await openResourceReport(container)
      await pickRadio(container, 'resource_mismatch')
      await setTextarea(container, '问题描述', '再次尝试提交同资源问题')
      await act(async () => {
        findButton(container, '提交')!.click()
      })
      await flush()
      expect(mocks.toast.error).toHaveBeenCalledWith(
        '您今天已经提交过该资源的问题'
      )
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
      expect(mocks.toast.error).toHaveBeenCalledWith(
        '网络错误，提交失败，请重试'
      )
      expect(findButton(container, '提交')!.disabled).toBe(false)
    })
  })

  describe('user profile「举报」', () => {
    it('hides on the own profile and asks guests to log in', async () => {
      const own = await mount(
        <ReportUserButton targetUserId={100} targetUserName="Tester" />
      )
      expect(own.querySelector('button')).toBeNull()

      mocks.user = { uid: 0, name: '', role: 0 }
      const guest = await mount(
        <ReportUserButton targetUserId={200} targetUserName="某人" />
      )
      await act(async () => {
        findButton(guest, '举报')!.click()
      })
      expect(guest.textContent).toContain('举报需要先登录账号')
      expect(guest.querySelector('textarea')).toBeNull()
    })

    it('submits content_violation with the 3-day hint and shows the result', async () => {
      mocks.kunFetchPost.mockResolvedValue({
        case: { id: 6, public: false, subscriberCount: null },
        created: true,
        subscribed: false
      })
      const container = await mount(
        <ReportUserButton targetUserId={200} targetUserName="某人" />
      )
      await act(async () => {
        findButton(container, '举报')!.click()
      })
      expect(container.textContent).toContain('预计首次响应在 3 天内')
      expect(container.textContent).toContain('被举报的用户看不到你的举报')
      await setTextarea(container, '举报原因', '违规内容')
      await act(async () => {
        findButton(container, '提交举报')!.click()
      })
      await flush()
      expect(mocks.kunFetchPost).toHaveBeenCalledWith('/case', {
        kind: 'content_violation',
        targetType: 'user',
        targetId: 200,
        content: '违规内容',
        imageKeys: []
      })
      expect(container.textContent).toContain(
        '已交给网站管理员，预计 3 天内首次回应'
      )
    })

    it('does not reveal other reporters of a private report on a dedup hit', async () => {
      mocks.kunFetchPost.mockResolvedValue({
        case: { id: 6, public: false, subscriberCount: null },
        created: false,
        subscribed: true
      })
      const container = await mount(
        <ReportUserButton targetUserId={200} targetUserName="某人" />
      )
      await act(async () => {
        findButton(container, '举报')!.click()
      })
      await setTextarea(container, '举报原因', '违规内容')
      await act(async () => {
        findButton(container, '提交举报')!.click()
      })
      await flush()
      const text = container.textContent ?? ''
      expect(text).toContain('已提交')
      expect(text).not.toContain('相同问题')
      expect(text).not.toContain('人报告')
    })
  })

  describe('item page「反馈」(D14, D22)', () => {
    const onOpenResources = vi.fn()
    const feedback = () => (
      <FeedbackButton patch={patch} onOpenResources={onOpenResources} />
    )
    const openFeedback = async (container: HTMLElement) => {
      await act(async () => {
        container
          .querySelector<HTMLButtonElement>('button[aria-label="游戏反馈"]')!
          .click()
      })
    }

    it('prompts guests to log in as soon as they open it', async () => {
      mocks.user = { uid: 0, name: '', role: 0 }
      const container = await mount(feedback())
      await openFeedback(container)
      expect(container.textContent).toContain('提交反馈需要先登录账号')
      expect(container.querySelector('textarea')).toBeNull()
    })

    it('submits entry corrections as patch_info to the site administrator', async () => {
      mocks.kunFetchPost.mockResolvedValue(
        created(8, { case: { id: 8, public: false, subscriberCount: null } })
      )
      const container = await mount(feedback())
      await openFeedback(container)

      expect(container.textContent).toContain(
        '由网站管理员核对后修改，预计首次响应在 7 天内'
      )
      // 重复条目并入「条目资料有误」
      expect(container.textContent).toContain(
        '和其他条目重复也选这一项，写明重复的条目链接'
      )
      await setTextarea(container, '问题描述', '发售日期应为 2019-04-26')
      await act(async () => {
        findButton(container, '提交')!.click()
      })
      await flush()
      expect(mocks.kunFetchPost).toHaveBeenCalledWith('/case', {
        kind: 'patch_info',
        targetType: 'patch',
        targetId: 1,
        content: '发售日期应为 2019-04-26',
        imageKeys: []
      })
      expect(container.textContent).toContain(
        '已交给网站管理员，预计 7 天内首次回应'
      )
    })

    it('posts other cases without a response promise', async () => {
      mocks.kunFetchPost.mockResolvedValue(created(9))
      const container = await mount(feedback())
      await openFeedback(container)

      // 「其他」不承诺时限
      await pickRadio(container, 'other')
      expect(container.textContent).toContain('不承诺首次响应时限')
      await setTextarea(container, '问题描述', '条目相关的其他问题描述')
      await act(async () => {
        findButton(container, '提交')!.click()
      })
      await flush()
      expect(mocks.kunFetchPost).toHaveBeenCalledWith('/case', {
        kind: 'other',
        targetType: 'patch',
        targetId: 1,
        content: '条目相关的其他问题描述',
        imageKeys: []
      })
    })

    it('points wrong-patch resources to the resource card (M03-9)', async () => {
      const container = await mount(feedback())
      await openFeedback(container)
      await pickRadio(container, 'resource_wrong_patch')

      // 只给指引，不建事项
      expect(container.textContent).toContain('选择「发在了错误的条目下」')
      expect(container.querySelector('textarea')).toBeNull()
      expect(findButton(container, '提交')).toBeUndefined()

      await act(async () => {
        findButton(container, '去资源链接')!.click()
      })
      expect(onOpenResources).toHaveBeenCalledTimes(1)
      expect(container.querySelector('[role="dialog"]')).toBeNull()
      // 再次打开回到默认的「条目资料有误」
      await openFeedback(container)
      expect(
        container.querySelector('textarea[aria-label="问题描述"]')
      ).not.toBeNull()
      expect(mocks.kunFetchPost).not.toHaveBeenCalled()
    })

    it('points link failures to the resource card (D38)', async () => {
      const container = await mount(feedback())
      await openFeedback(container)
      await pickRadio(container, 'resource_link_failure')

      // 只给指引，不建事项
      expect(container.textContent).toContain('选择「链接失效」')
      expect(container.querySelector('textarea')).toBeNull()
      expect(findButton(container, '提交')).toBeUndefined()

      await act(async () => {
        findButton(container, '去资源链接')!.click()
      })
      expect(onOpenResources).toHaveBeenCalledTimes(1)
      expect(container.querySelector('[role="dialog"]')).toBeNull()
      expect(mocks.kunFetchPost).not.toHaveBeenCalled()
    })

    it('answers resource requests with the contribution guide (M03-9)', async () => {
      const container = await mount(feedback())
      await openFeedback(container)
      await pickRadio(container, 'request_resource')

      expect(container.textContent).toContain('等待求助区建成')
      expect(
        container.querySelector('a[href="/doc/notice/contribute"]')
          ?.textContent
      ).toBe('内容贡献指南')
      expect(container.querySelector('textarea')).toBeNull()
      expect(findButton(container, '提交')).toBeUndefined()
      expect(findButton(container, '关闭')).toBeDefined()
    })
  })
})
