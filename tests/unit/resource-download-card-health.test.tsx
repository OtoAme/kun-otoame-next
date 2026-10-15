import React, { act } from 'react'
import type { Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
  kunFetchPost: vi.fn(),
  kunFetchPut: vi.fn(),
  user: { uid: 100, name: 'Tester', role: 1 }
}))

vi.mock('react-hot-toast', () => ({ default: mocks.toast }))
vi.mock('~/utils/kunFetch', () => ({
  kunFetchPost: mocks.kunFetchPost,
  kunFetchPut: mocks.kunFetchPut
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
vi.mock('~/components/kun/external-link/ExternalLink', () => ({
  KunExternalLink: ({
    children
  }: {
    children?: React.ReactNode
    link: string
  }) => <a href="#">{children}</a>
}))

vi.mock('@heroui/button', () => ({
  Button: ({
    children,
    onPress,
    isDisabled,
    isLoading,
    startContent
  }: {
    children?: React.ReactNode
    onPress?: () => void
    isDisabled?: boolean
    isLoading?: boolean
    startContent?: React.ReactNode
  }) => (
    <button type="button" disabled={isDisabled || isLoading} onClick={onPress}>
      {startContent}
      {children}
    </button>
  )
}))
vi.mock('@heroui/chip', () => ({
  Chip: ({ children }: { children?: React.ReactNode }) => (
    <span>{children}</span>
  )
}))
vi.mock('@heroui/snippet', () => ({
  Snippet: ({
    children,
    className,
    classNames
  }: {
    children?: React.ReactNode
    className?: string
    classNames?: { base?: string; pre?: string }
  }) => (
    <span className={className} data-pre-class={classNames?.pre}>
      {children}
    </span>
  )
}))

vi.mock('@heroui/react', async () => {
  const R = await import('react')
  const toArray = (children: React.ReactNode): React.ReactElement[] =>
    (Array.isArray(children) ? children.flat() : [children]).filter(
      (child): child is React.ReactElement => R.isValidElement(child)
    )
  return {
    Modal: ({
      isOpen,
      children,
      hideCloseButton
    }: {
      isOpen: boolean
      children?: React.ReactNode
      hideCloseButton?: boolean
    }) =>
      isOpen ? (
        <div
          role="dialog"
          data-hide-close-button={hideCloseButton ? 'true' : 'false'}
        >
          {children}
        </div>
      ) : null,
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
    Button: ({
      children,
      onPress,
      isDisabled,
      isLoading,
      startContent,
      'aria-label': ariaLabel
    }: {
      children?: React.ReactNode
      onPress?: () => void
      isDisabled?: boolean
      isLoading?: boolean
      startContent?: React.ReactNode
      'aria-label'?: string
    }) => (
      <button
        type="button"
        aria-label={ariaLabel}
        disabled={isDisabled || isLoading}
        onClick={onPress}
      >
        {startContent}
        {children}
      </button>
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
    Radio: () => null,
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
            </label>
          )
        })}
      </div>
    ),
    Popover: ({ children }: { children?: React.ReactNode }) => (
      <div>{children}</div>
    ),
    PopoverTrigger: ({ children }: { children?: React.ReactNode }) => (
      <>{children}</>
    ),
    PopoverContent: ({ children }: { children?: React.ReactNode }) => (
      <div>{children}</div>
    ),
    useDisclosure: () => {
      const [isOpen, setIsOpen] = R.useState(false)
      return {
        isOpen,
        onOpen: () => setIsOpen(true),
        onClose: () => setIsOpen(false),
        onOpenChange: setIsOpen
      }
    },
    Card: ({
      children,
      id,
      className
    }: {
      children?: React.ReactNode
      id?: string
      className?: string
    }) => (
      <div id={id} className={className}>
        {children}
      </div>
    ),
    CardBody: ({
      children,
      className
    }: {
      children?: React.ReactNode
      className?: string
    }) => <div className={className}>{children}</div>
  }
})

import type { PatchResource, PatchResourceHealthLink } from '~/types/api/patch'
import type { LinkHealthMutationResponse } from '~/types/api/linkHealth'

globalThis.React = React

// DownloadCard 依赖 HeroUI 在 JSDOM 里的 React 全局，必须在环境就绪后动态导入
let ResourceDownloadCard: typeof import('~/components/patch/resource/DownloadCard').ResourceDownloadCard

const healthLink = (
  overrides: Partial<PatchResourceHealthLink> = {}
): PatchResourceHealthLink => ({
  id: 21,
  storage: 'user',
  size: '2 GB',
  hash: '',
  sortOrder: 1,
  download: 0,
  version: 3,
  evidenceRound: 1,
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

const accessedLink = {
  id: 21,
  storage: 'user',
  size: '2 GB',
  content: 'https://pan.quark.cn/s/SYN',
  code: 'abcd',
  password: '',
  hash: '',
  version: 3
}

const resource: PatchResource = {
  id: 11,
  name: '测试资源',
  section: 'galgame',
  uniqueId: 'ABCDEFGH',
  type: ['pc'],
  language: ['zh-Hans'],
  platform: ['windows'],
  note: '',
  links: [],
  likeCount: 0,
  download: 0,
  isLike: false,
  status: 0,
  userId: 3,
  patchId: 7,
  created: '2026-07-06T00:00:00.000Z',
  user: { id: 3, name: 'Saya', avatar: '', patchCount: 1, role: 2 }
}

const mutationResponse = (
  overrides: Partial<PatchResourceHealthLink> = {}
): LinkHealthMutationResponse => ({
  link: {
    patchId: 7,
    resourceId: 11,
    linkId: 21,
    version: 3,
    evidenceRound: 1,
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
  },
  changed: false
})

describe('ResourceDownloadCard link health (04/10)', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  beforeEach(async () => {
    vi.clearAllMocks()
    if (!ResourceDownloadCard) {
      ;({ ResourceDownloadCard } = await import(
        '~/components/patch/resource/DownloadCard'
      ))
    }
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
    [...container.querySelectorAll('button')].find(
      (button) =>
        button.textContent?.includes(text) ||
        button.getAttribute('aria-label')?.includes(text)
    )

  const findExactButton = (container: HTMLElement, text: string) =>
    [...container.querySelectorAll('button')].find(
      (button) =>
        button.textContent === text ||
        button.getAttribute('aria-label') === text
    )

  it('always shows the health label and only offers 报告失效 after credentials are revealed', async () => {
    const hidden = await mount(
      <ResourceDownloadCard resource={resource} link={healthLink()} />
    )
    expect(hidden.textContent).toContain('正常 · 2 GB')
    expect(
      hidden.querySelector('button[aria-label="正常，查看检测详情"]')
    ).not.toBeNull()
    expect(hidden.querySelector('.kun-link-health-dot')).not.toBeNull()
    expect(findButton(hidden, '报告失效')).toBeUndefined()

    const shown = await mount(
      <ResourceDownloadCard
        resource={resource}
        link={healthLink()}
        restoredLink={accessedLink}
      />
    )
    expect(findButton(shown, '报告失效')).not.toBeUndefined()
  })

  it('keeps the access entry and shows every fact on a suspect link', async () => {
    const container = await mount(
      <ResourceDownloadCard
        resource={resource}
        link={healthLink({
          health: 'suspect',
          recentReportCount: 3,
          latestCheck: {
            verdict: 'available',
            provider: 'quark',
            reason: 'share_available',
            failed: false,
            checkedAt: '2026-10-09T00:00:00.000Z',
            attemptedAt: '2026-10-09T00:00:00.000Z',
            stale: false
          }
        })}
      />
    )
    const text = container.textContent ?? ''
    expect(text).toContain('获取下载链接')
    expect(text).toContain('疑似失效 · 2 GB')
    expect(text).toContain('夸克网盘')
    expect(text).toContain('检测端可访问')
    expect(text).toContain('近期 3 人报告问题')
    expect(text).toContain('疑似失效，等待归属方处理')
    expect(findButton(container, '报告失效')).toBeUndefined()
  })

  it('keeps acquisition on machine/user conflict disputes with the frozen copy', async () => {
    const container = await mount(
      <ResourceDownloadCard
        resource={resource}
        link={healthLink({
          health: 'disputed',
          disputeSource: 'machine_user_conflict',
          ownerType: 'staff',
          recentReportCount: 5
        })}
      />
    )
    const text = container.textContent ?? ''
    expect(text).toContain('获取下载链接')
    expect(text).toContain('检测端可访问，但有用户反馈异常 · 等待复核')
  })

  it('keeps acquisition on folded broken links and still shows capability-driven actions', async () => {
    const onRelink = vi.fn()
    const container = await mount(
      <ResourceDownloadCard
        resource={resource}
        link={healthLink({
          health: 'broken',
          recentReportCount: 4,
          capabilities: {
            ownerActions: ['verify'],
            resolveActions: [],
            canCheck: true,
            canEdit: true
          }
        })}
        onRelink={onRelink}
      />
    )
    const text = container.textContent ?? ''
    expect(text).toContain('获取下载链接')
    expect(text).toContain('已失效 · 2 GB')
    expect(text).not.toContain('该链接已失效，暂不提供获取')
    expect(text).toContain('近期 4 人报告问题')
    expect(findButton(container, '报告失效')).toBeUndefined()

    // 补链走既有编辑入口（定位地址栏），不直接写
    await act(async () => {
      findButton(container, '补链')!.click()
    })
    expect(onRelink).toHaveBeenCalledTimes(1)
    // 未确认前没有任何写请求
    expect(mocks.kunFetchPost).not.toHaveBeenCalled()

    // 核实可用先确认，再携带完整基点
    mocks.kunFetchPost.mockResolvedValue(mutationResponse({ health: 'ok' }))
    await act(async () => {
      findButton(container, '我已核实可用')!.click()
    })
    await act(async () => {
      findExactButton(container, '确认')!.click()
    })
    await act(async () => {})
    expect(mocks.kunFetchPost).toHaveBeenCalledWith(
      '/patch/resource/link/health',
      {
        patchId: 7,
        resourceId: 11,
        linkId: 21,
        linkVersion: 3,
        evidenceRound: 1,
        health: 'broken',
        healthChangedAt: null,
        action: 'verify'
      }
    )
  })

  it('submits the quick report with the weak-evidence acknowledgement and merges the response', async () => {
    mocks.kunFetchPost.mockResolvedValue({
      ...mutationResponse({ health: 'suspect', recentReportCount: 4 }),
      report: 'recorded',
      weight: 0.5,
      caseId: 12
    })
    const container = await mount(
      <ResourceDownloadCard
        resource={resource}
        link={healthLink()}
        restoredLink={accessedLink}
      />
    )
    await act(async () => {
      findButton(container, '报告失效')!.click()
    })

    const dialog = container.querySelector('[role="dialog"]')!
    await act(async () => {
      ;[...dialog.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
        .find((radio) => radio.value === 'unreachable')!
        .click()
    })
    expect(findButton(dialog as HTMLElement, '提交')!.disabled).toBe(true)

    await act(async () => {
      dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()
    })
    await act(async () => {
      findButton(dialog as HTMLElement, '提交')!.click()
    })
    await act(async () => {})

    expect(mocks.kunFetchPost).toHaveBeenCalledWith(
      '/patch/resource/link/report',
      {
        patchId: 7,
        resourceId: 11,
        linkId: 21,
        linkVersion: 3,
        reason: 'unreachable',
        networkAcknowledged: true
      }
    )
    expect(dialog.textContent).toContain('已交给其归属方处理')
  })

  it('surfaces the named 409 and never silently refresh-resubmits check', async () => {
    mocks.kunFetchPost.mockResolvedValue('该链接已更新，请刷新后重试')
    const container = await mount(
      <ResourceDownloadCard
        resource={resource}
        link={healthLink({
          capabilities: {
            ownerActions: [],
            resolveActions: [],
            canCheck: true,
            canEdit: false
          }
        })}
      />
    )

    await act(async () => {
      findButton(container, '检测链接')!.click()
    })
    await act(async () => {
      findExactButton(container, '确认')!.click()
    })
    await act(async () => {})

    expect(mocks.kunFetchPost).toHaveBeenCalledTimes(1)
    expect(mocks.kunFetchPost).toHaveBeenCalledWith(
      '/patch/resource/link-check',
      expect.objectContaining({ patchId: 7, linkVersion: 3 })
    )
    expect(mocks.toast.error).toHaveBeenCalledWith('该链接已更新，请刷新后重试')
    // 确认弹窗关闭，无第二次请求
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('legacy links without health data render today’s plain card', async () => {
    const container = await mount(
      <ResourceDownloadCard
        resource={resource}
        link={{
          id: 30,
          storage: 'user',
          size: '1 GB',
          hash: '',
          sortOrder: 1,
          download: 0
        }}
      />
    )
    const text = container.textContent ?? ''
    expect(text).toContain('获取下载链接')
    expect(text).not.toContain('机器检测')
    expect(text).not.toContain('近期')
    expect(findButton(container, '报告失效')).toBeUndefined()
  })
})

describe('RUI-01 credential identity fencing', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  beforeEach(async () => {
    vi.clearAllMocks()
    if (!ResourceDownloadCard) {
      ;({ ResourceDownloadCard } = await import(
        '~/components/patch/resource/DownloadCard'
      ))
    }
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
    [...container.querySelectorAll('button')].find(
      (button) =>
        button.textContent?.includes(text) ||
        button.getAttribute('aria-label')?.includes(text)
    )

  const accessResponse = (version: number, content: string) => ({
    link: {
      id: 21,
      storage: 'user',
      size: '2 GB',
      content,
      code: 'code-1',
      password: 'secret',
      hash: '',
      version
    },
    access: {
      kind: 'link_revealed',
      actorType: 'user',
      cost: 0,
      obtainedExpiresAt: '2026-10-10T00:00:00.000Z'
    }
  })

  it('hides the old address once the same link advances to a new version', async () => {
    mocks.kunFetchPost.mockResolvedValueOnce(
      accessResponse(3, 'https://pan.example.com/v3')
    )
    const container = await mount(
      <ResourceDownloadCard
        resource={resource}
        link={healthLink({ version: 3 })}
      />
    )
    await act(async () => {
      findButton(container, '获取下载链接')!.click()
    })
    await act(async () => {})
    expect(container.textContent).toContain('https://pan.example.com/v3')

    // 补链 v3→v4：同 id 的旧地址立即消失，回到获取入口
    await rerender(
      <ResourceDownloadCard
        resource={resource}
        link={healthLink({ version: 4 })}
      />
    )
    expect(container.textContent).not.toContain('https://pan.example.com/v3')
    expect(findButton(container, '获取下载链接')).not.toBeUndefined()
  })

  it('discards a delayed access response from an older generation without reviving it', async () => {
    let resolveAccess: ((value: unknown) => void) | undefined
    mocks.kunFetchPost.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAccess = resolve
        })
    )
    const container = await mount(
      <ResourceDownloadCard
        resource={resource}
        link={healthLink({ version: 3 })}
      />
    )
    await act(async () => {
      findButton(container, '获取下载链接')!.click()
    })
    // 请求在飞期间目标已推进版本：迟到回包丢弃且按钮释放
    await rerender(
      <ResourceDownloadCard
        resource={resource}
        link={healthLink({ version: 4 })}
      />
    )
    await act(async () => {
      resolveAccess?.(accessResponse(3, 'https://pan.example.com/v3'))
    })
    await act(async () => {})
    expect(container.textContent).not.toContain('https://pan.example.com/v3')
    expect(findButton(container, '获取下载链接')!.disabled).toBe(false)
    expect(mocks.kunFetchPost).toHaveBeenCalledTimes(1)
  })

  it('rejects a same-flight response whose version no longer matches the snapshot', async () => {
    mocks.kunFetchPost.mockResolvedValueOnce(
      accessResponse(4, 'https://pan.example.com/v4')
    )
    const container = await mount(
      <ResourceDownloadCard
        resource={resource}
        link={healthLink({ version: 3 })}
      />
    )
    await act(async () => {
      findButton(container, '获取下载链接')!.click()
    })
    await act(async () => {})
    expect(container.textContent).not.toContain('https://pan.example.com/v4')
    expect(mocks.toast.error).toHaveBeenCalledWith('该链接已更新，请刷新后重试')
    expect(container.textContent).toContain('该链接已更新，请刷新后重试')
  })

  it('applies restored credentials only when the versions match', async () => {
    // restored v2 vs 当前 v3：恢复结果隐藏，显示获取入口
    const container = await mount(
      <ResourceDownloadCard
        resource={resource}
        link={healthLink({ version: 3, revealed: true })}
        restoredLink={
          {
            id: 21,
            storage: 'user',
            size: '2 GB',
            content: 'https://pan.example.com/v2',
            code: 'old',
            password: 'old',
            hash: '',
            version: 2
          } as never
        }
        restoredObtainedExpiresAt="2026-10-10T00:00:00.000Z"
      />
    )
    expect(container.textContent).not.toContain('https://pan.example.com/v2')
    expect(findButton(container, '查看已获取链接')).not.toBeUndefined()

    await rerender(
      <ResourceDownloadCard
        resource={resource}
        link={healthLink({ version: 2, revealed: true })}
        restoredLink={
          {
            id: 21,
            storage: 'user',
            size: '2 GB',
            content: 'https://pan.example.com/v2',
            code: 'old',
            password: 'old',
            hash: '',
            version: 2
          } as never
        }
        restoredObtainedExpiresAt="2026-10-10T00:00:00.000Z"
      />
    )
    expect(container.textContent).toContain('https://pan.example.com/v2')
    expect(container.textContent).toContain('old')
  })
})

describe('RUI-02 one projection drives display, basis and buttons', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  beforeEach(async () => {
    vi.clearAllMocks()
    if (!ResourceDownloadCard) {
      ;({ ResourceDownloadCard } = await import(
        '~/components/patch/resource/DownloadCard'
      ))
    }
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
    [...container.querySelectorAll('button')].find(
      (button) =>
        button.textContent?.includes(text) ||
        button.getAttribute('aria-label')?.includes(text)
    )

  const findExactButton = (container: HTMLElement, text: string) =>
    [...container.querySelectorAll('button')].find(
      (button) =>
        button.textContent === text ||
        button.getAttribute('aria-label') === text
    )

  it('after a successful verify the next action uses the returned round and health', async () => {
    const verifiedView = {
      patchId: 7,
      resourceId: 11,
      linkId: 21,
      version: 2,
      evidenceRound: 2,
      health: 'ok' as const,
      healthChangedAt: '2026-10-09T02:00:00.000Z',
      verifiedAt: '2026-10-09T02:00:00.000Z',
      lastRelinkAt: null,
      ownerType: 'publisher' as const,
      disputeSource: null,
      recentReportCount: 0,
      latestCheck: null,
      capabilities: {
        ownerActions: ['verify' as const],
        resolveActions: [],
        canCheck: false,
        canEdit: false
      }
    }
    mocks.kunFetchPost
      .mockResolvedValueOnce({ link: verifiedView, changed: true })
      .mockResolvedValueOnce({ link: verifiedView, changed: false })

    const container = await mount(
      <ResourceDownloadCard
        resource={resource}
        link={healthLink({
          id: 21,
          version: 2,
          evidenceRound: 1,
          health: 'suspect',
          healthChangedAt: '2026-10-08T00:00:00.000Z',
          capabilities: {
            ownerActions: ['verify', 'confirm_broken'],
            resolveActions: [],
            canCheck: false,
            canEdit: false
          }
        })}
      />
    )

    await act(async () => {
      findButton(container, '我已核实可用')!.click()
    })
    await act(async () => {
      findExactButton(container, '确认')!.click()
    })
    await act(async () => {})
    expect(mocks.kunFetchPost).toHaveBeenNthCalledWith(
      1,
      '/patch/resource/link/health',
      expect.objectContaining({ evidenceRound: 1, health: 'suspect' })
    )

    // 第二次动作：基点来自返回后的投影（轮次/健康已推进），不是旧 link
    await act(async () => {
      findButton(container, '我已核实可用')!.click()
    })
    await act(async () => {
      findExactButton(container, '确认')!.click()
    })
    await act(async () => {})
    expect(mocks.kunFetchPost).toHaveBeenNthCalledWith(
      2,
      '/patch/resource/link/health',
      expect.objectContaining({
        evidenceRound: 2,
        health: 'ok',
        healthChangedAt: '2026-10-09T02:00:00.000Z'
      })
    )
  })

  it('a newer server snapshot always wins over an older local override (broken after relink)', async () => {
    const okView = {
      patchId: 7,
      resourceId: 11,
      linkId: 21,
      version: 2,
      evidenceRound: 2,
      health: 'ok' as const,
      healthChangedAt: '2026-10-09T02:00:00.000Z',
      verifiedAt: '2026-10-09T02:00:00.000Z',
      lastRelinkAt: null,
      ownerType: 'publisher' as const,
      disputeSource: null,
      recentReportCount: 0,
      latestCheck: null,
      capabilities: {
        ownerActions: [] as never[],
        resolveActions: [],
        canCheck: false,
        canEdit: false
      }
    }
    mocks.kunFetchPost.mockResolvedValueOnce({ link: okView, changed: true })
    const container = await mount(
      <ResourceDownloadCard
        resource={resource}
        link={healthLink({
          version: 2,
          evidenceRound: 1,
          health: 'suspect',
          capabilities: {
            ownerActions: ['verify', 'confirm_broken'],
            resolveActions: [],
            canCheck: false,
            canEdit: false
          }
        })}
      />
    )
    await act(async () => {
      findButton(container, '我已核实可用')!.click()
    })
    await act(async () => {
      findExactButton(container, '确认')!.click()
    })
    await act(async () => {})

    // 随后服务端推进到 v3 broken：本地 ok 覆盖绝不能压过新快照
    await rerender(
      <ResourceDownloadCard
        resource={resource}
        link={healthLink({
          version: 3,
          evidenceRound: 3,
          health: 'broken'
        })}
      />
    )
    expect(container.textContent).toContain('已失效 · 2 GB')
    expect(container.textContent).not.toContain('该链接已失效，暂不提供获取')
    expect(findButton(container, '获取下载链接')).not.toBeUndefined()
  })

  it('merges a parent-provided health update by version ordering and drops it when the server passes it', async () => {
    const parentUpdate = {
      patchId: 7,
      resourceId: 11,
      linkId: 21,
      version: 2,
      evidenceRound: 3,
      health: 'suspect' as const,
      healthChangedAt: '2026-10-09T03:00:00.000Z',
      verifiedAt: null,
      lastRelinkAt: null,
      ownerType: 'publisher' as const,
      disputeSource: null,
      recentReportCount: 3,
      latestCheck: null,
      capabilities: {
        ownerActions: [] as never[],
        resolveActions: [],
        canCheck: false,
        canEdit: false
      }
    }
    const container = await mount(
      <ResourceDownloadCard
        resource={resource}
        link={healthLink({ version: 2, evidenceRound: 1, health: 'ok' })}
        healthUpdate={parentUpdate}
      />
    )
    expect(container.textContent).toContain('疑似失效，等待归属方处理')
    expect(container.textContent).toContain('近期 3 人报告问题')

    // 服务端读到 v3 ok（补链后）：父级旧更新被有序丢弃
    await rerender(
      <ResourceDownloadCard
        resource={resource}
        link={healthLink({ version: 3, evidenceRound: 0, health: 'ok' })}
        healthUpdate={parentUpdate}
      />
    )
    expect(container.textContent).not.toContain('疑似失效，等待归属方处理')
    expect(findButton(container, '获取下载链接')).not.toBeUndefined()
  })
})

describe('read-snapshot provenance for credentials and mutations', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  beforeEach(async () => {
    vi.clearAllMocks()
    if (!ResourceDownloadCard) {
      ;({ ResourceDownloadCard } = await import(
        '~/components/patch/resource/DownloadCard'
      ))
    }
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
    [...container.querySelectorAll('button')].find(
      (button) =>
        button.textContent?.includes(text) ||
        button.getAttribute('aria-label')?.includes(text)
    )

  const findExactButton = (container: HTMLElement, text: string) =>
    [...container.querySelectorAll('button')].find(
      (button) =>
        button.textContent === text ||
        button.getAttribute('aria-label') === text
    )

  const accessResponse = (version: number, content: string, code: string) => ({
    link: {
      id: 21,
      storage: 'user',
      size: '2 GB',
      content,
      code,
      password: 'secret',
      hash: '',
      version
    },
    access: {
      kind: 'link_revealed',
      actorType: 'user',
      cost: 0,
      obtainedExpiresAt: '2026-10-10T00:00:00.000Z'
    }
  })

  it('same-version code-only refresh: a new read snapshot retires prior manual credentials at render', async () => {
    mocks.kunFetchPost.mockResolvedValueOnce(
      accessResponse(3, 'https://pan.example.com/v3', 'code-A')
    )
    const container = await mount(
      <ResourceDownloadCard
        resource={resource}
        link={healthLink({ id: 21, version: 3, revealed: true })}
      />
    )
    await act(async () => {
      findButton(container, '查看已获取链接')!.click()
    })
    await act(async () => {})
    expect(container.textContent).toContain('code-A')

    // 同版本、同地址，只有提取码变化的新快照：渲染即回到快照（不再保留 code-A）
    const snapshotB = {
      ...resource,
      links: [healthLink({ id: 21, version: 3, revealed: true })]
    }
    await rerender(
      <ResourceDownloadCard
        resource={snapshotB}
        link={snapshotB.links[0]}
        restoredLink={
          {
            id: 21,
            storage: 'user',
            size: '2 GB',
            content: 'https://pan.example.com/v3',
            code: 'code-B',
            password: 'secret',
            hash: '',
            version: 3
          } as never
        }
        restoredObtainedExpiresAt="2026-10-10T00:00:00.000Z"
      />
    )
    expect(container.textContent).toContain('code-B')
    expect(container.textContent).not.toContain('code-A')
  })

  it('same target id switching binds by full identity, not version alone', async () => {
    mocks.kunFetchPost.mockResolvedValueOnce(
      accessResponse(3, 'https://pan.example.com/id21', 'code-1')
    )
    const container = await mount(
      <ResourceDownloadCard
        resource={resource}
        link={healthLink({ id: 21, version: 3 })}
      />
    )
    await act(async () => {
      findButton(container, '获取下载链接')!.click()
    })
    await act(async () => {})
    expect(container.textContent).toContain('https://pan.example.com/id21')

    // 换到同版本但不同 id 的链接（在父级水平 key 不变的极端假设下）也不能沿用
    const otherLinkTarget = healthLink({ id: 22, version: 3 })
    await rerender(
      <ResourceDownloadCard resource={resource} link={otherLinkTarget} />
    )
    expect(container.textContent).not.toContain('https://pan.example.com/id21')
  })

  it('drops a mutation response arriving after the read snapshot advanced (tie round)', async () => {
    let resolveHealth: ((value: unknown) => void) | undefined
    mocks.kunFetchPost.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveHealth = resolve
        })
    )
    const suspect = healthLink({
      version: 2,
      evidenceRound: 1,
      health: 'suspect',
      capabilities: {
        ownerActions: ['verify'],
        resolveActions: [],
        canCheck: false,
        canEdit: false
      }
    })
    const container = await mount(
      <ResourceDownloadCard resource={resource} link={suspect} />
    )
    await act(async () => {
      findButton(container, '我已核实可用')!.click()
    })
    await act(async () => {
      findExactButton(container, '确认')!.click()
    })

    // 服务端新快照在响应前就位：同版本同轮次的 suspect（含更新的快照事实）
    const renewed = {
      ...resource,
      links: [healthLink({ ...suspect, recentReportCount: 9 })]
    }
    await rerender(
      <ResourceDownloadCard resource={renewed} link={renewed.links[0]} />
    )

    await act(async () => {
      resolveHealth?.({
        link: {
          patchId: 7,
          resourceId: 11,
          linkId: 21,
          version: 2,
          evidenceRound: 2,
          health: 'ok',
          healthChangedAt: '2026-10-09T05:00:00.000Z',
          verifiedAt: '2026-10-09T05:00:00.000Z',
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
          }
        },
        changed: true
      })
    })
    await act(async () => {})
    // 旧快照发起的响应被丢弃：新快照事实（suspect + 人数）保留
    expect(container.textContent).toContain('疑似失效，等待归属方处理')
    expect(container.textContent).toContain('近期 9 人报告问题')
  })

  it('confirmation X/遮罩在提交期间不可用，成功后显式关闭 (HeroUI v2)', async () => {
    let resolveCheck: ((value: unknown) => void) | undefined
    mocks.kunFetchPost.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCheck = resolve
        })
    )
    const container = await mount(
      <ResourceDownloadCard
        resource={resource}
        link={healthLink({
          capabilities: {
            ownerActions: [],
            resolveActions: [],
            canCheck: true,
            canEdit: false
          }
        })}
      />
    )
    await act(async () => {
      findButton(container, '检测链接')!.click()
    })
    const dialogBefore = container.querySelectorAll('[role="dialog"]').length
    expect(dialogBefore).toBeGreaterThan(0)
    await act(async () => {
      findExactButton(container, '确认')!.click()
    })
    // 提交期间：mock 透传的 hideCloseButton/isDismissable 已随 submitting 置位
    expect(
      container.querySelector('[data-hide-close-button="true"]')
    ).not.toBeNull()

    await act(async () => {
      resolveCheck?.({
        link: {
          patchId: 7,
          resourceId: 11,
          linkId: 21,
          version: 3,
          evidenceRound: 1,
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
            canCheck: true,
            canEdit: false
          }
        },
        changed: false,
        check: 'observed'
      })
    })
    await act(async () => {})
    expect(findExactButton(container, '确认')).toBeUndefined()
  })
})
