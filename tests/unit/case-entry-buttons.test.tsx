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
  type ButtonProps = {
    children?: React.ReactNode
    onPress?: () => void
    isDisabled?: boolean
    isLoading?: boolean
    href?: string
    'aria-label'?: string
  }
  return {
    Button: R.forwardRef<HTMLButtonElement, ButtonProps>(
      (
        {
          children,
          onPress,
          isDisabled,
          isLoading,
          href,
          'aria-label': ariaLabel
        },
        ref
      ) =>
        href ? (
          <a href={href} aria-label={ariaLabel}>
            {children}
          </a>
        ) : (
          <button
            ref={ref}
            aria-label={ariaLabel}
            disabled={isDisabled || isLoading}
            onClick={onPress}
          >
            {children}
          </button>
        )
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
    Chip: ({ children }: { children?: React.ReactNode }) => (
      <span>{children}</span>
    ),
    Checkbox: ({
      children,
      isSelected,
      onValueChange
    }: {
      children?: React.ReactNode
      isSelected?: boolean
      onValueChange?: (checked: boolean) => void
    }) => (
      <label>
        <input
          type="checkbox"
          checked={!!isSelected}
          onChange={(event) => onValueChange?.(event.target.checked)}
        />
        {children}
      </label>
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
import type { PatchResource, PatchResourceHealthLink } from '~/types/api/patch'
import type { LinkHealthMutationResponse } from '~/types/api/linkHealth'

globalThis.React = React

const healthLink = (
  overrides: Partial<PatchResourceHealthLink> = {}
): PatchResourceHealthLink => ({
  id: 101,
  storage: 'user',
  size: '2 GB',
  hash: '',
  sortOrder: 1,
  download: 0,
  version: 2,
  evidenceRound: 0,
  health: 'ok',
  healthChangedAt: null,
  verifiedAt: null,
  lastRelinkAt: null,
  ownerType: 'publisher',
  disputeSource: null,
  recentReportCount: 0,
  latestCheck: null,
  capabilities: {
    ownerActions: [],
    resolveActions: [],
    canCheck: false,
    canEdit: false
  },
  ...overrides
})

const resource = {
  id: 7,
  name: '资源X',
  section: 'galgame',
  patchId: 1,
  links: [healthLink({ id: 101 }), healthLink({ id: 102, health: 'broken' })],
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

const reportResponse = (
  overrides: Record<string, unknown> = {}
): LinkHealthMutationResponse & Record<string, unknown> => ({
  link: {
    patchId: 1,
    resourceId: 7,
    linkId: 101,
    version: 2,
    evidenceRound: 0,
    health: 'ok',
    healthChangedAt: null,
    verifiedAt: null,
    lastRelinkAt: null,
    ownerType: 'publisher',
    disputeSource: null,
    recentReportCount: 1,
    latestCheck: null,
    capabilities: {
      ownerActions: [],
      resolveActions: [],
      canCheck: false,
      canEdit: false
    }
  },
  changed: false,
  report: 'recorded',
  weight: 1,
  caseId: null,
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

  const openEntry = async (container: HTMLElement) => {
    await act(async () => {
      findButton(container, '遇到问题')!.click()
    })
  }

  /** 05 两步：先选目标再下一步；链接目标用 `link:<id>`，整条资源用 resource。 */
  const pickTargetAndNext = async (container: HTMLElement, target: string) => {
    await pickRadio(container, target)
    await act(async () => {
      findButton(container, '下一步')!.click()
    })
  }

  describe('resource card「遇到问题」(05 两步)', () => {
    it('lists every link including folded broken ones plus the whole resource as targets', async () => {
      const container = await mount(
        <ReportResourceButton resource={resource} patchId={1} />
      )
      await openEntry(container)

      const radios = [
        ...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')
      ].map((radio) => radio.value)
      expect(radios).toEqual(['link:101', 'link:102', 'resource'])
      expect(container.textContent).toContain('已失效')
      expect(findButton(container, '下一步')!.disabled).toBe(true)
    })

    it('keeps the target when going back and keeps no draft after closing', async () => {
      mocks.kunFetchPost.mockResolvedValue(created(5))
      const container = await mount(
        <ReportResourceButton resource={resource} patchId={1} />
      )
      await openEntry(container)
      await pickTargetAndNext(container, 'resource')
      expect(container.textContent).toContain('当前目标')
      expect(container.textContent).toContain('整条资源')

      // 返回上一步不丢目标
      await act(async () => {
        findButton(container, '上一步')!.click()
      })
      expect(
        container.querySelector<HTMLInputElement>('input[value="resource"]')!
          .checked
      ).toBe(true)

      // 关闭不留草稿：再次打开回到第一步且无选择
      await pickTargetAndNext(container, 'resource')
      await pickRadio(container, 'resource_mismatch')
      await setTextarea(container, '问题描述', '临时草稿文字保留检验')
      await act(async () => {
        findButton(container, '取消')!.click()
      })
      await openEntry(container)
      expect(container.querySelector('input[value="resource"]')).not.toBeNull()
      expect(
        container.querySelector('textarea[aria-label="问题描述"]')
      ).toBeNull()
    })

    it('shows guests every phenomenon including violation, and guides login before a case', async () => {
      mocks.user = { uid: 0, name: '', role: 0 }
      const container = await mount(
        <ReportResourceButton resource={resource} patchId={1} />
      )
      await openEntry(container)
      await pickTargetAndNext(container, 'resource')

      const text = container.textContent ?? ''
      expect(text).toContain('资源与描述不符')
      expect(text).toContain('发在了错误的条目下')
      expect(text).toContain('疑似违规或有害内容')

      // 违规举报现象带 3 天首次响应提示
      await pickRadio(container, 'violation')
      expect(container.textContent).toContain('预计首次响应在 3 天内')

      // 指南现象只给说明没有提交按钮；切回事项现象后访客被引导登录
      await pickRadio(container, 'download_slow')
      expect(container.textContent).toContain('这类问题不需要提交')
      expect(findButton(container, '提交')).toBeUndefined()

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

    it('files runtime problems and resource requests with guides alongside the form (D40)', async () => {
      mocks.kunFetchPost.mockResolvedValue(created(11))
      const container = await mount(
        <ReportResourceButton resource={resource} patchId={1} />
      )
      await openEntry(container)
      await pickTargetAndNext(container, 'resource')
      await pickRadio(container, 'archive_or_runtime')

      // 说明链接和输入框同时显示（D40）
      expect(
        container.querySelector('a[href="/doc/notice/repair-rar"]')?.textContent
      ).toBe('压缩包修复教程')
      expect(
        container.querySelector('a[href="/doc/notice/start"]')?.textContent
      ).toBe('网站说明和常见问题')
      expect(
        container.querySelector('textarea[aria-label="问题描述"]')
      ).not.toBeNull()
      expect(container.textContent).toContain(
        '该问题先由资源发布者处理，预计首次响应在 7 天内'
      )

      await setTextarea(container, '问题描述', '解压到一半提示压缩包已损坏')
      await act(async () => {
        findButton(container, '提交')!.click()
      })
      await flush()
      expect(mocks.kunFetchPost).toHaveBeenCalledWith('/case', {
        kind: 'resource_runtime',
        targetType: 'resource',
        targetId: 7,
        expectedPatchId: 1,
        content: '解压到一半提示压缩包已损坏',
        imageKeys: []
      })
      expect(container.textContent).toContain(
        '已交给资源发布者，预计 7 天内首次回应'
      )
    })

    it('files resource requests and other resource problems as their own kinds (D40)', async () => {
      mocks.kunFetchPost.mockResolvedValue(created(12))
      const container = await mount(
        <ReportResourceButton resource={resource} patchId={1} />
      )
      await openEntry(container)
      await pickTargetAndNext(container, 'resource')
      await pickRadio(container, 'request_resource')

      expect(
        container.querySelector('a[href="/doc/notice/contribute"]')?.textContent
      ).toBe('内容贡献指南')
      await setTextarea(container, '问题描述', '希望更新到 v1.1 版本')
      await act(async () => {
        findButton(container, '提交')!.click()
      })
      await flush()
      expect(mocks.kunFetchPost).toHaveBeenCalledWith('/case', {
        kind: 'resource_request',
        targetType: 'resource',
        targetId: 7,
        expectedPatchId: 1,
        content: '希望更新到 v1.1 版本',
        imageKeys: []
      })

      // 「其他」提交 resource_other
      await act(async () => {
        findButton(container, '关闭')!.click()
      })
      mocks.kunFetchPost.mockResolvedValue(created(13))
      await openEntry(container)
      await pickTargetAndNext(container, 'resource')
      await pickRadio(container, 'resource_other')
      await setTextarea(container, '问题描述', '资源页的其他问题描述')
      await act(async () => {
        findButton(container, '提交')!.click()
      })
      await flush()
      expect(mocks.kunFetchPost).toHaveBeenCalledWith('/case', {
        kind: 'resource_other',
        targetType: 'resource',
        targetId: 7,
        expectedPatchId: 1,
        content: '资源页的其他问题描述',
        imageKeys: []
      })
    })

    it('names the admin on official resources and files violation with a 3-day hint', async () => {
      mocks.kunFetchPost.mockResolvedValue(created(6))
      const container = await mount(
        <ReportResourceButton resource={officialResource} patchId={1} />
      )
      await openEntry(container)
      await pickTargetAndNext(container, 'resource')
      await pickRadio(container, 'violation')

      expect(container.textContent).toContain(
        '该问题由网站管理员处理，预计首次响应在 3 天内'
      )
      expect(container.textContent).toContain(
        '网站管理员能看到你的用户名和说明'
      )
      await setTextarea(container, '问题描述', '资源里夹带了恶意文件，请处理')
      await act(async () => {
        findButton(container, '提交')!.click()
      })
      await flush()
      expect(mocks.kunFetchPost).toHaveBeenCalledWith(
        '/case',
        expect.objectContaining({ kind: 'content_violation' })
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
      await openEntry(container)
      await pickTargetAndNext(container, 'resource')
      await pickRadio(container, 'wrong_patch')

      const text = container.textContent ?? ''
      expect(text).toContain('该问题由网站管理员处理，预计首次响应在 7 天内')
      expect(
        container
          .querySelector('textarea[aria-label="问题描述"]')
          ?.getAttribute('placeholder')
      ).toBe('这条资源实际属于哪个游戏（游戏名或条目链接）……')
      await setTextarea(
        container,
        '问题描述',
        '这是条目B的汉化补丁，不属于这里'
      )
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
    })

    it('keeps the draft on business errors and releases loading on network errors', async () => {
      mocks.kunFetchPost.mockResolvedValue('您今天已经提交过该资源的问题')
      const container = await mount(
        <ReportResourceButton resource={resource} patchId={1} />
      )
      await openEntry(container)
      await pickTargetAndNext(container, 'resource')
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

    it('uploads images and sends their keys with the case (D11)', async () => {
      mocks.kunFetchFormData.mockResolvedValue({
        key: 'case/100/1-a.avif',
        url: 'https://img.example/case/100/1-a.avif'
      })
      mocks.kunFetchPost.mockResolvedValue(created(7))
      const container = await mount(
        <ReportResourceButton resource={resource} patchId={1} />
      )
      await openEntry(container)
      await pickTargetAndNext(container, 'resource')
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
  })

  describe('link-target failure reports (04 投票)', () => {
    it('submits a strong report with the version triple and shows the recorded outcome', async () => {
      mocks.kunFetchPost.mockResolvedValue(reportResponse())
      const container = await mount(
        <ReportResourceButton resource={resource} patchId={1} />
      )
      await openEntry(container)
      await pickTargetAndNext(container, 'link:101')

      expect(container.textContent).toContain('当前目标')
      expect(container.textContent).toContain('链接 #1')
      await pickRadio(container, 'link_deleted')
      expect(container.textContent).toContain('累计到阈值后由该链接的归属方')

      await act(async () => {
        findButton(container, '提交')!.click()
      })
      await flush()
      expect(mocks.kunFetchPost).toHaveBeenCalledWith(
        '/patch/resource/link/report',
        {
          patchId: 1,
          resourceId: 7,
          linkId: 101,
          linkVersion: 2,
          reason: 'deleted'
        }
      )
      expect(container.textContent).toContain('已记录一次报告')
      expect(container.textContent).toContain('暂不通知归属方')
    })

    it('announces the owner handoff only when the server returns a caseId', async () => {
      mocks.kunFetchPost.mockResolvedValue(reportResponse({ caseId: 44 }))
      const container = await mount(
        <ReportResourceButton resource={resource} patchId={1} />
      )
      await openEntry(container)
      await pickTargetAndNext(container, 'link:101')
      await pickRadio(container, 'link_access_condition')
      await act(async () => {
        findButton(container, '提交')!.click()
      })
      await flush()
      expect(container.textContent).toContain('该链接的问题已交给其归属方处理')
    })

    it('requires the network acknowledgement before a weak report can be sent', async () => {
      mocks.kunFetchPost.mockResolvedValue(
        reportResponse({ report: 'recorded', weight: 0.5 })
      )
      const container = await mount(
        <ReportResourceButton resource={resource} patchId={1} />
      )
      await openEntry(container)
      await pickTargetAndNext(container, 'link:101')
      await pickRadio(container, 'link_unreachable')

      expect(container.textContent).toContain('尝试更换网络或加速器')
      expect(findButton(container, '提交')!.disabled).toBe(true)
      expect(mocks.kunFetchPost).not.toHaveBeenCalled()

      const checkbox = container.querySelector<HTMLInputElement>(
        'input[type="checkbox"]'
      )!
      await act(async () => {
        checkbox.click()
      })
      expect(findButton(container, '提交')!.disabled).toBe(false)
      await act(async () => {
        findButton(container, '提交')!.click()
      })
      await flush()
      expect(mocks.kunFetchPost).toHaveBeenCalledWith(
        '/patch/resource/link/report',
        {
          patchId: 1,
          resourceId: 7,
          linkId: 101,
          linkVersion: 2,
          reason: 'unreachable',
          networkAcknowledged: true
        }
      )
    })

    it('surfaces named errors verbatim and keeps the selection', async () => {
      mocks.kunFetchPost.mockResolvedValue('该链接已更新，请刷新后重试')
      const container = await mount(
        <ReportResourceButton resource={resource} patchId={1} />
      )
      await openEntry(container)
      await pickTargetAndNext(container, 'link:101')
      await pickRadio(container, 'link_deleted')
      await act(async () => {
        findButton(container, '提交')!.click()
      })
      await flush()
      expect(mocks.toast.error).toHaveBeenCalledWith(
        '该链接已更新，请刷新后重试'
      )
      // 保留选择与表单，不自动刷新重交
      expect(findButton(container, '提交')).not.toBeUndefined()
    })

    it('disables reporting with a refresh hint when the client holds no version', async () => {
      const legacyResource = {
        ...resource,
        links: [
          {
            id: 201,
            storage: 'user',
            size: '1 GB',
            hash: '',
            sortOrder: 1,
            download: 0
          }
        ]
      } as unknown as PatchResource
      const container = await mount(
        <ReportResourceButton resource={legacyResource} patchId={1} />
      )
      await openEntry(container)
      // 单链接资源默认选中该链接，直接进入下一步
      await act(async () => {
        findButton(container, '下一步')!.click()
      })
      await pickRadio(container, 'link_deleted')
      expect(container.textContent).toContain('请刷新页面后再报告')
      expect(findButton(container, '提交')!.disabled).toBe(true)
      expect(mocks.kunFetchPost).not.toHaveBeenCalled()
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
  })

  describe('item page「反馈」(D14, D22, D38-D40)', () => {
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

    it('offers all five options including the link-failure guide (D38)', async () => {
      const container = await mount(feedback())
      await openFeedback(container)
      const radios = [
        ...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')
      ].map((radio) => radio.value)
      expect(radios).toEqual([
        'patch_info',
        'resource_wrong_patch',
        'resource_link_failure',
        'resource_request',
        'other'
      ])
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
    })

    it('points wrong-patch reports to the 遇到困难 entry (D34)', async () => {
      const container = await mount(feedback())
      await openFeedback(container)
      await pickRadio(container, 'resource_wrong_patch')

      expect(container.textContent).toContain('点「遇到问题」')
      expect(container.textContent).toContain('发在了错误的条目下')
      expect(container.querySelector('textarea')).toBeNull()
      expect(findButton(container, '提交')).toBeUndefined()

      await act(async () => {
        findButton(container, '去资源链接')!.click()
      })
      expect(onOpenResources).toHaveBeenCalledTimes(1)
      expect(container.querySelector('[role="dialog"]')).toBeNull()
    })

    it('points link failures to the per-link 报告失效 entry (D38)', async () => {
      const container = await mount(feedback())
      await openFeedback(container)
      await pickRadio(container, 'resource_link_failure')

      expect(container.textContent).toContain('在那条链接旁点「报告失效」')
      expect(container.textContent).toContain('站内资源盘链接由网站管理员处理')
      expect(container.querySelector('textarea')).toBeNull()
      expect(findButton(container, '提交')).toBeUndefined()

      await act(async () => {
        findButton(container, '去资源链接')!.click()
      })
      expect(onOpenResources).toHaveBeenCalledTimes(1)
      expect(mocks.kunFetchPost).not.toHaveBeenCalled()
    })

    it('files resource requests to the site administrator with the contribution guide shown (D40)', async () => {
      mocks.kunFetchPost.mockResolvedValue(created(14))
      const container = await mount(feedback())
      await openFeedback(container)
      await pickRadio(container, 'resource_request')

      expect(
        container.querySelector('a[href="/doc/notice/contribute"]')?.textContent
      ).toBe('内容贡献指南')
      expect(container.textContent).toContain(
        '由网站管理员处理，不承诺首次响应时限'
      )
      await setTextarea(container, '问题描述', '想要这个游戏的汉化版资源')
      await act(async () => {
        findButton(container, '提交')!.click()
      })
      await flush()
      expect(mocks.kunFetchPost).toHaveBeenCalledWith('/case', {
        kind: 'resource_request',
        targetType: 'patch',
        targetId: 1,
        content: '想要这个游戏的汉化版资源',
        imageKeys: []
      })
    })
  })
})

describe('RUI-05 entry boundary and result copy', () => {
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
    const { createRoot } = await import('react-dom/client')
    const container = dom.window.document.getElementById('root')!
    root = createRoot(container)
    await act(async () => {
      root!.render(ui)
    })
    return container
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

  const findButton = (container: HTMLElement, text: string) =>
    [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes(text)
    )

  it('keeps the whole-resource path usable on a zero-link resource', async () => {
    mocks.kunFetchPost.mockResolvedValue(created(20))
    const zeroLinkResource = { ...resource, links: [] }
    const container = await mount(
      <ReportResourceButton resource={zeroLinkResource} patchId={1} />
    )
    await act(async () => {
      findButton(container, '遇到问题')!.click()
    })

    const radios = [
      ...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')
    ].map((radio) => radio.value)
    expect(radios).toEqual(['resource'])

    await pickRadio(container, 'resource')
    expect(findButton(container, '下一步')!.disabled).toBe(false)
    await act(async () => {
      findButton(container, '下一步')!.click()
    })
    await pickRadio(container, 'resource_mismatch')
    expect(
      container.querySelector('textarea[aria-label="问题描述"]')
    ).not.toBeNull()
    await setTextarea(container, '问题描述', '这条资源的描述与内容不一致')
    await act(async () => {
      findButton(container, '提交')!.click()
    })
    await act(async () => {})
    expect(mocks.kunFetchPost).toHaveBeenCalledWith(
      '/case',
      expect.objectContaining({ kind: 'resource_mismatch' })
    )
  })

  it('shows the 3-day first response on the violation result page', async () => {
    mocks.kunFetchPost.mockResolvedValue(
      created(21, { case: { id: 21, public: false, subscriberCount: null } })
    )
    const container = await mount(
      <ReportResourceButton resource={resource} patchId={1} />
    )
    await act(async () => {
      findButton(container, '遇到问题')!.click()
    })
    await pickRadio(container, 'resource')
    await act(async () => {
      findButton(container, '下一步')!.click()
    })
    await pickRadio(container, 'violation')
    await setTextarea(container, '问题描述', '资源里夹带了恶意文件，请处理')
    await act(async () => {
      findButton(container, '提交')!.click()
    })
    await act(async () => {})
    expect(container.textContent).toContain(
      '已交给网站管理员，预计 3 天内首次回应'
    )
  })

  it('propagates a two-step report success through onReported', async () => {
    mocks.kunFetchPost.mockResolvedValue(reportResponse({ caseId: 44 }))
    const onReported = vi.fn()
    const container = await mount(
      <ReportResourceButton
        resource={resource}
        patchId={1}
        onReported={onReported}
      />
    )
    await act(async () => {
      findButton(container, '遇到问题')!.click()
    })
    await pickRadio(container, 'link:101')
    await act(async () => {
      findButton(container, '下一步')!.click()
    })
    await pickRadio(container, 'link_deleted')
    await act(async () => {
      findButton(container, '提交')!.click()
    })
    await act(async () => {})
    expect(onReported).toHaveBeenCalledTimes(1)
    const payload = onReported.mock.calls[0][0]
    expect(payload.linkId).toBe(101)
    expect(payload.version).toBe(2)
    expect(payload.recentReportCount).toBe(1)
  })
})

describe('two-step phenomenon switch resets the report panel', () => {
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
    const { createRoot } = await import('react-dom/client')
    const container = dom.window.document.getElementById('root')!
    root = createRoot(container)
    await act(async () => {
      root!.render(ui)
    })
    return container
  }

  const pickRadio = async (container: HTMLElement, value: string) => {
    const radio = [
      ...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')
    ].find((candidate) => candidate.value === value)!
    await act(async () => {
      radio.click()
    })
  }

  const findButton = (container: HTMLElement, text: string) =>
    [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes(text)
    )

  it('switching deleted → unreachable requires the ack and submits the weak reason; switching back sends no ack', async () => {
    mocks.kunFetchPost.mockResolvedValue(reportResponse())
    const container = await mount(
      <ReportResourceButton resource={resource} patchId={1} />
    )
    await act(async () => {
      findButton(container, '遇到问题')!.click()
    })
    await pickRadio(container, 'link:101')
    await act(async () => {
      findButton(container, '下一步')!.click()
    })
    // 先选强证据，再切弱证据：面板必须重建并索要网络确认
    await pickRadio(container, 'link_deleted')
    await pickRadio(container, 'link_unreachable')

    expect(container.textContent).toContain('尝试更换网络或加速器')
    expect(findButton(container, '提交')!.disabled).toBe(true)
    expect(mocks.kunFetchPost).not.toHaveBeenCalled()

    await act(async () => {
      container
        .querySelector<HTMLInputElement>('input[type="checkbox"]')!
        .click()
    })
    await act(async () => {
      findButton(container, '提交')!.click()
    })
    await act(async () => {})
    expect(mocks.kunFetchPost).toHaveBeenCalledWith(
      '/patch/resource/link/report',
      {
        patchId: 1,
        resourceId: 7,
        linkId: 101,
        linkVersion: 2,
        reason: 'unreachable',
        networkAcknowledged: true
      }
    )

    // 切回强证据：ack 状态不串台，请求不携 networkAcknowledged
    const reopened = await mount(
      <ReportResourceButton resource={resource} patchId={1} />
    )
    await act(async () => {
      findButton(reopened, '遇到问题')!.click()
    })
    await pickRadio(reopened, 'link:101')
    await act(async () => {
      findButton(reopened, '下一步')!.click()
    })
    await pickRadio(reopened, 'link_unreachable')
    await pickRadio(reopened, 'link_deleted')
    expect(reopened.querySelector('input[type="checkbox"]')).toBeNull()
    await act(async () => {
      findButton(reopened, '提交')!.click()
    })
    await act(async () => {})
    expect(mocks.kunFetchPost).toHaveBeenCalledWith(
      '/patch/resource/link/report',
      {
        patchId: 1,
        resourceId: 7,
        linkId: 101,
        linkVersion: 2,
        reason: 'deleted'
      }
    )
  })
})
