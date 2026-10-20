import React, { act } from 'react'
import type { Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LinkMaintenanceItem } from '~/types/api/linkMaintenance'
import type { WorkspaceResourceDetail } from '~/types/api/workspace'
import { WORKSPACE_ERRORS } from '~/constants/workspace'

globalThis.React = React

const userState = vi.hoisted(() => ({
  user: {
    uid: 8,
    role: 2,
    name: '作者',
    moemoepointAvailable: 30
  }
}))

const mocks = vi.hoisted(() => ({
  kunFetchGet: vi.fn(),
  kunFetchPut: vi.fn(),
  kunFetchDelete: vi.fn(),
  kunFetchPost: vi.fn(),
  axiosPost: vi.fn(),
  push: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}))

const workspaceUser = vi.hoisted(() => ({
  id: 8,
  name: '作者',
  role: 2
}))

vi.mock('~/store/userStore', () => ({
  useUserStore: (
    selector: (state: { user: typeof userState.user }) => unknown
  ) => selector({ user: userState.user })
}))
vi.mock('~/utils/kunFetch', () => ({
  kunFetchGet: mocks.kunFetchGet,
  kunFetchPut: mocks.kunFetchPut,
  kunFetchDelete: mocks.kunFetchDelete,
  kunFetchPost: mocks.kunFetchPost
}))
vi.mock('axios', () => ({
  default: { post: mocks.axiosPost }
}))
vi.mock('react-hot-toast', () => ({ default: mocks.toast }))
vi.mock('next/image', () => ({
  default: () => null
}))
vi.mock('~/components/dashboard/ui/dialog', () => ({
  Dialog: ({
    open,
    children
  }: {
    open?: boolean
    children?: React.ReactNode
  }) => (open ? <div role="dialog">{children}</div> : null),
  DialogContent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children?: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
  DialogFooter: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  )
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push })
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
vi.mock('~/components/dashboard/ui/select', async () => {
  const ReactModule = await import('react')
  type Option = { value: string; label?: React.ReactNode; disabled?: boolean }
  const Ctx = ReactModule.createContext<{
    value: string
    disabled?: boolean
    options: Option[]
    onValueChange?: (value: string) => void
  }>({ value: '', options: [] })
  const collect = (node: React.ReactNode, out: Option[]) => {
    ReactModule.Children.forEach(node, (child) => {
      if (!ReactModule.isValidElement(child)) return
      const props = child.props as {
        value?: string
        disabled?: boolean
        children?: React.ReactNode
      }
      if (typeof props.value === 'string') {
        out.push({
          value: props.value,
          label: props.children,
          disabled: props.disabled
        })
        return
      }
      collect(props.children, out)
    })
  }
  return {
    Select: ({
      value,
      disabled,
      onValueChange,
      children
    }: {
      value?: string
      disabled?: boolean
      onValueChange?: (value: string) => void
      children?: React.ReactNode
    }) => {
      const options: Option[] = []
      collect(children, options)
      return (
        <Ctx.Provider
          value={{ value: value ?? '', disabled, options, onValueChange }}
        >
          <div>{children}</div>
        </Ctx.Provider>
      )
    },
    SelectTrigger: ({
      'aria-label': ariaLabel,
      'aria-labelledby': ariaLabelledby,
      className
    }: {
      children?: React.ReactNode
      'aria-label'?: string
      'aria-labelledby'?: string
      className?: string
    }) => {
      const ctx = ReactModule.useContext(Ctx)
      return (
        <select
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledby}
          className={className}
          disabled={ctx.disabled}
          value={ctx.value}
          onChange={(event) => ctx.onValueChange?.(event.target.value)}
        >
          {ctx.options.map((option) => (
            <option
              key={option.value}
              value={option.value}
              disabled={option.disabled}
            >
              {option.value}
            </option>
          ))}
        </select>
      )
    },
    SelectValue: () => null,
    SelectContent: ({ children }: { children?: React.ReactNode }) => (
      <div data-testid="select-content">{children}</div>
    ),
    SelectItem: ({
      children,
      value
    }: {
      children?: React.ReactNode
      value: string
      disabled?: boolean
    }) => <span data-value={value}>{children}</span>
  }
})
vi.mock('~/components/dashboard/ui/dropdown-menu', async () => {
  const ReactModule = await import('react')
  return {
    DropdownMenu: ({ children }: { children?: React.ReactNode }) => (
      <div>{children}</div>
    ),
    DropdownMenuTrigger: ({
      children
    }: {
      children?: React.ReactNode
      asChild?: boolean
    }) => <>{children}</>,
    DropdownMenuContent: ({ children }: { children?: React.ReactNode }) => (
      <div role="menu">{children}</div>
    ),
    DropdownMenuGroup: ({ children }: { children?: React.ReactNode }) => (
      <div>{children}</div>
    ),
    DropdownMenuLabel: ({ children }: { children?: React.ReactNode }) => (
      <div>{children}</div>
    ),
    DropdownMenuSeparator: () => null,
    DropdownMenuItem: ({ children }: { children?: React.ReactNode }) => (
      <div>{children}</div>
    ),
    DropdownMenuCheckboxItem: ({
      children,
      checked,
      onCheckedChange
    }: {
      children?: React.ReactNode
      checked?: boolean
      onSelect?: (event: Event) => void
      onCheckedChange?: (checked: boolean) => void
    }) => (
      <label>
        <input
          type="checkbox"
          checked={!!checked}
          onChange={() => onCheckedChange?.(!checked)}
        />
        {children}
      </label>
    )
  }
})
vi.mock('~/components/dashboard/ui/alert-dialog', async () => {
  const ReactModule = await import('react')
  const Ctx = ReactModule.createContext<(open: boolean) => void>(() => {})
  return {
    AlertDialog: ({
      open,
      onOpenChange,
      children
    }: {
      open?: boolean
      onOpenChange?: (open: boolean) => void
      children?: React.ReactNode
    }) => (
      <Ctx.Provider value={onOpenChange ?? (() => {})}>
        {open ? <div role="alertdialog">{children}</div> : null}
      </Ctx.Provider>
    ),
    AlertDialogContent: ({ children }: { children?: React.ReactNode }) => (
      <div>{children}</div>
    ),
    AlertDialogHeader: ({ children }: { children?: React.ReactNode }) => (
      <div>{children}</div>
    ),
    AlertDialogFooter: ({ children }: { children?: React.ReactNode }) => (
      <div>{children}</div>
    ),
    AlertDialogTitle: ({ children }: { children?: React.ReactNode }) => (
      <h2>{children}</h2>
    ),
    AlertDialogDescription: ({ children }: { children?: React.ReactNode }) => (
      <p>{children}</p>
    ),
    AlertDialogCancel: ({
      children,
      disabled
    }: {
      children?: React.ReactNode
      disabled?: boolean
    }) => {
      const onOpenChange = ReactModule.useContext(Ctx)
      return (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onOpenChange(false)}
        >
          {children}
        </button>
      )
    }
  }
})

import {
  WorkspaceResourceEditor,
  buildWorkspaceResourceUpdate,
  linkInput,
  sessionFromDetail
} from '~/components/dashboard/workspace/WorkspaceResourceEditor'
import { WorkspaceUserProvider } from '~/components/dashboard/workspace/WorkspaceShell'
import { WorkspaceResourceUpload } from '~/components/dashboard/workspace/WorkspaceResourceUpload'

const detail = (
  overrides: Partial<WorkspaceResourceDetail> = {}
): WorkspaceResourceDetail => ({
  id: 9,
  patchId: 3,
  patchUniqueId: 'game',
  patchName: '游戏甲',
  patchBanner: '',
  name: '资源甲',
  section: 'galgame',
  status: 0,
  created: '2026-10-01T00:00:00.000Z',
  linkCount: 2,
  actionableCount: 0,
  capabilities: { canEdit: true, canDelete: true, canUpload: true },
  note: '备注',
  type: ['pc'],
  language: ['zh-Hans'],
  platform: ['windows'],
  baseLinks: [
    { id: 1, version: 1 },
    { id: 2, version: 4 }
  ],
  links: [
    { id: 1, version: 1, storage: 'touchgal', protected: true },
    {
      id: 2,
      version: 4,
      storage: 'user',
      protected: false,
      content: 'https://origin.example/a',
      code: 'code',
      password: 'pw',
      hash: 'hash',
      size: '1GB'
    }
  ],
  maintenance: [],
  ...overrides
})

const maintenanceItem = (
  overrides: Partial<LinkMaintenanceItem> = {}
): LinkMaintenanceItem => ({
  patchId: 3,
  resourceId: 9,
  linkId: 2,
  linkVersion: 4,
  eventId: 1,
  round: 1,
  maintenanceRevision: 6,
  state: 'pending',
  snoozedUntil: null,
  openedAt: '2026-10-01T00:00:00.000Z',
  respondedAt: null,
  response: null,
  reportCount: 1,
  caseId: null,
  patch: { uniqueId: 'game', name: '游戏甲' },
  resource: { name: '资源甲', section: 'galgame' },
  storage: 'user',
  health: {
    version: 4,
    evidenceRound: 2,
    health: 'broken',
    healthChangedAt: '2026-10-01T00:00:00.000Z',
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
  capabilities: { actions: ['respond'] },
  ...overrides
})

describe('workspace resource editor', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined
  let current: WorkspaceResourceDetail
  let scrolled: Element[]

  beforeEach(() => {
    vi.clearAllMocks()
    userState.user = { uid: 0, role: 0, name: '空', moemoepointAvailable: 0 }
    workspaceUser.id = 8
    workspaceUser.name = '作者'
    workspaceUser.role = 2
    current = detail()
    scrolled = []
    mocks.kunFetchGet.mockImplementation(async (url: string) => {
      if (url === '/auth/captcha') {
        return { images: [], sessionId: 'captcha-session' }
      }
      return current
    })
  })

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    root = undefined
    dom?.window.close()
    dom = undefined
    vi.unstubAllGlobals()
  })

  const mount = async (resourceId = 9, focusLinkId?: number) => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost/workspace/resources/9'
    })
    dom.window.HTMLElement.prototype.scrollIntoView = function (
      this: HTMLElement
    ) {
      scrolled.push(this)
    }
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const { createRoot } = await import('react-dom/client')
    const container = dom.window.document.getElementById('root')!
    root = createRoot(container)
    await act(async () => {
      root!.render(
        <WorkspaceUserProvider user={{ ...workspaceUser }}>
          <WorkspaceResourceEditor
            resourceId={resourceId}
            focusLinkId={focusLinkId}
          />
        </WorkspaceUserProvider>
      )
    })
    await act(async () => {})
    return container
  }

  const button = (rootNode: ParentNode, text: string) =>
    [...rootNode.querySelectorAll('button')].find((item) =>
      item.textContent?.includes(text)
    )

  const setValue = (input: HTMLInputElement, value: string) => {
    const proto = Object.getOwnPropertyDescriptor(
      dom!.window.HTMLInputElement.prototype,
      'value'
    )
    proto?.set?.call(input, value)
    input.dispatchEvent(new dom!.window.Event('input', { bubbles: true }))
  }

  const settle = async () => {
    for (let i = 0; i < 4; i += 1) await act(async () => {})
  }

  it('sends a protected slot as exactly id then version', () => {
    const session = sessionFromDetail(detail())
    const payload = buildWorkspaceResourceUpdate(session)
    expect(Object.keys(payload.links[0]!)).toEqual(['id', 'version'])
    expect(payload.links[0]).toEqual({ id: 1, version: 1 })
    expect(payload.links[1]).toEqual({
      id: 2,
      storage: 'user',
      content: 'https://origin.example/a',
      code: 'code',
      password: 'pw',
      hash: 'hash',
      size: '1GB'
    })
    expect(payload.baseLinks).toEqual([
      { id: 1, version: 1 },
      { id: 2, version: 4 }
    ])
    expect(
      linkInput({
        key: 'p',
        protected: true,
        id: 7,
        version: 3,
        storage: 'touchgal'
      })
    ).toEqual({ id: 7, version: 3 })
  })

  it('keeps the draft and captured base across 409 and a background refresh', async () => {
    const container = await mount()
    const address = container.querySelector(
      'input[aria-label="链接地址"]'
    ) as HTMLInputElement
    const password = container.querySelector(
      'input[aria-label="解压码"]'
    ) as HTMLInputElement
    expect(address.className).toContain('break-all')
    expect(address.className).toContain('[overflow-wrap:anywhere]')
    await act(async () => {
      setValue(address, 'https://draft.example/' + 'long'.repeat(30))
      setValue(password, 'draft-secret')
    })

    current = detail({
      baseLinks: [
        { id: 1, version: 9 },
        { id: 2, version: 9 }
      ],
      links: [
        { id: 1, version: 9, storage: 'touchgal', protected: true },
        {
          id: 2,
          version: 9,
          storage: 'user',
          protected: false,
          content: 'https://server.example/replaced',
          code: 'other',
          password: 'other-secret',
          hash: 'other',
          size: '2GB'
        }
      ]
    })
    const readsBefore = mocks.kunFetchGet.mock.calls.filter(
      (call) => call[0] === '/workspace/resources/9'
    ).length
    // 草稿未提交时点「载入最新版本」只弹确认，不发 GET
    await act(async () => {
      button(container, '载入最新版本')!.click()
    })
    await settle()
    const reloadDialog = dom!.window.document.querySelector(
      '[role="alertdialog"]'
    )!
    expect(reloadDialog.textContent).toContain('尚未保存的修改')
    expect(
      mocks.kunFetchGet.mock.calls.filter(
        (call) => call[0] === '/workspace/resources/9'
      )
    ).toHaveLength(readsBefore)
    await act(async () => {
      button(reloadDialog, '取消')!.click()
    })
    await settle()
    expect(
      mocks.kunFetchGet.mock.calls.filter(
        (call) => call[0] === '/workspace/resources/9'
      )
    ).toHaveLength(readsBefore)
    expect(address.value).toContain('https://draft.example/')
    expect(password.value).toBe('draft-secret')

    mocks.kunFetchPut.mockResolvedValue(WORKSPACE_ERRORS.conflict.message)
    await act(async () => {
      button(container, '保存')!.click()
    })
    await settle()
    const conflictBody = mocks.kunFetchPut.mock.calls[0][1]
    expect(Object.keys(conflictBody.links[0])).toEqual(['id', 'version'])
    expect(conflictBody.links[0]).toEqual({ id: 1, version: 1 })
    expect(conflictBody.baseLinks).toEqual([
      { id: 1, version: 1 },
      { id: 2, version: 4 }
    ])
    expect(conflictBody.links[1].content).toContain('https://draft.example/')
    expect(conflictBody.links[1].password).toBe('draft-secret')
    expect(address.value).toContain('https://draft.example/')
    expect(password.value).toBe('draft-secret')
    expect(container.textContent).toContain(WORKSPACE_ERRORS.conflict.message)

    current = detail({
      baseLinks: [
        { id: 1, version: 2 },
        { id: 2, version: 5 }
      ],
      links: [
        { id: 1, version: 2, storage: 'touchgal', protected: true },
        {
          id: 2,
          version: 5,
          storage: 'user',
          protected: false,
          content: 'https://canonical.example/saved',
          code: 'saved-code',
          password: 'saved-secret',
          hash: 'saved-hash',
          size: '4GB'
        }
      ]
    })
    mocks.kunFetchPut.mockResolvedValue({
      links: [
        { id: 1, version: 2 },
        { id: 2, version: 5 }
      ],
      linkChecks: []
    })
    await act(async () => {
      button(container, '保存')!.click()
    })
    await settle()
    expect(address.value).toBe('https://canonical.example/saved')
    expect(password.value).toBe('saved-secret')

    // 保存成功后基线已跟服务端一致，草稿不脏：重新读取直接发请求，不弹确认
    current = detail({
      baseLinks: [
        { id: 1, version: 9 },
        { id: 2, version: 9 }
      ],
      links: [
        { id: 1, version: 9, storage: 'touchgal', protected: true },
        {
          id: 2,
          version: 9,
          storage: 'user',
          protected: false,
          content: 'https://server.example/wiped',
          code: 'wiped',
          password: 'wiped',
          hash: 'wiped',
          size: '9GB'
        }
      ]
    })
    await act(async () => {
      button(container, '载入最新版本')!.click()
    })
    await settle()
    expect(address.value).toBe('https://server.example/wiped')
    expect(password.value).toBe('wiped')

    current = detail({
      baseLinks: [
        { id: 1, version: 2 },
        { id: 2, version: 5 }
      ],
      links: [
        { id: 1, version: 2, storage: 'touchgal', protected: true },
        {
          id: 2,
          version: 5,
          storage: 'user',
          protected: false,
          content: 'https://canonical.example/saved',
          code: 'saved-code',
          password: 'saved-secret',
          hash: 'saved-hash',
          size: '4GB'
        }
      ]
    })
    // 草稿不脏：直接发请求并用返回内容重建会话
    await act(async () => {
      button(container, '载入最新版本')!.click()
    })
    await settle()
    expect(address.value).toBe('https://canonical.example/saved')
    expect(password.value).toBe('saved-secret')
    // 基线回到服务端版本后，保存提交的是 canonical 状态
    await act(async () => {
      button(container, '保存')!.click()
    })
    await settle()
    const savedBody = mocks.kunFetchPut.mock.calls.at(-1)?.[1]
    expect(savedBody.baseLinks).toEqual([
      { id: 1, version: 2 },
      { id: 2, version: 5 }
    ])
    expect(savedBody.links[0]).toEqual({ id: 1, version: 2 })
    expect(Object.keys(savedBody.links[0])).toEqual(['id', 'version'])
    expect(savedBody.links[1].password).toBe('saved-secret')
    expect(savedBody.links[1].uploadId).toBeUndefined()
  })

  it('confirms whole-resource deletion for the last link and cancels with no request', async () => {
    current = detail({
      linkCount: 1,
      baseLinks: [{ id: 2, version: 4 }],
      links: [
        {
          id: 2,
          version: 4,
          storage: 'user',
          protected: false,
          content: 'https://only.example/a',
          code: '',
          password: 'only-secret',
          hash: '',
          size: '1GB'
        }
      ]
    })
    const container = await mount()
    await act(async () => {
      button(container, '删除资源')!.click()
    })
    const dialog = dom!.window.document.querySelector('[role="alertdialog"]')!
    expect(dialog.textContent).toContain('萌萌点')
    expect(dialog.textContent).toContain('最后一条链接不能单独删除')
    await act(async () => {
      button(dialog, '取消')!.click()
    })
    expect(mocks.kunFetchDelete).not.toHaveBeenCalled()
    expect(
      dom!.window.document.querySelector('[role="alertdialog"]')
    ).toBeNull()
    expect(
      (
        container.querySelector(
          'input[aria-label="解压码"]'
        ) as HTMLInputElement
      ).value
    ).toBe('only-secret')

    await act(async () => {
      button(container, '删除资源')!.click()
    })
    await act(async () => {
      button(dom!.window.document, '确认删除')!.click()
    })
    await settle()
    expect(mocks.kunFetchDelete).toHaveBeenCalledWith('/workspace/resources/9')
    expect(mocks.push).toHaveBeenCalledWith('/workspace/resources')
  })

  it.each([
    ['pending', 2],
    ['banned', 1]
  ] as const)(
    'keeps whole-resource delete for a read-only %s resource that is not a resource disk',
    async (_label, status) => {
      current = detail({
        status,
        capabilities: { canEdit: false, canDelete: true, canUpload: false },
        links: [
          { id: 2, version: 4, storage: 'user', protected: true },
          { id: 3, version: 1, storage: 's3', protected: true }
        ],
        baseLinks: [
          { id: 2, version: 4 },
          { id: 3, version: 1 }
        ]
      })
      workspaceUser.role = 2
      const container = await mount()
      expect(container.textContent).toContain(
        '待审核或封禁的资源只读，不显示凭据'
      )
      for (const linkId of [2, 3]) {
        const slot = container.querySelector(`#workspace-link-${linkId}`)!
        expect(slot.textContent).toContain('这条链接只读，不显示凭据。')
        expect(slot.textContent).not.toContain('由网站管理')
        expect(slot.textContent).not.toContain('资源盘')
        expect(slot.querySelector('input')).toBeNull()
      }
      expect(container.querySelector('input[aria-label="链接地址"]')).toBeNull()
      expect(container.querySelector('input[aria-label="解压码"]')).toBeNull()
      expect(
        (
          container.querySelector(
            'input[aria-label="资源名称"]'
          ) as HTMLInputElement
        ).disabled
      ).toBe(true)
      expect(button(container, '保存')).toBeUndefined()
      expect(button(container, '添加链接')).toBeUndefined()
      expect(button(container, '移除这条链接')).toBeUndefined()
      const deleteResource = [...container.querySelectorAll('button')].find(
        (item) => item.textContent === '删除资源'
      )
      await act(async () => {
        deleteResource!.click()
      })
      const dialog = dom!.window.document.querySelector('[role="alertdialog"]')!
      expect(dialog.textContent).toContain('萌萌点')
      await act(async () => {
        button(dialog, '取消')!.click()
      })
      expect(
        dom!.window.document.querySelector('[role="alertdialog"]')
      ).toBeNull()
      expect(mocks.kunFetchDelete).not.toHaveBeenCalled()
      expect(mocks.kunFetchPut).not.toHaveBeenCalled()
      expect(mocks.kunFetchPost).not.toHaveBeenCalled()
    }
  )

  it('hides whole-resource delete when the server denies it for a resource disk', async () => {
    current = detail({
      capabilities: { canEdit: true, canDelete: false, canUpload: false },
      links: [
        { id: 1, version: 1, storage: 'touchgal', protected: true },
        {
          id: 2,
          version: 4,
          storage: 'user',
          protected: false,
          content: 'https://user.example/a',
          code: '',
          password: 'kept',
          hash: '',
          size: '1GB'
        }
      ],
      baseLinks: [
        { id: 1, version: 1 },
        { id: 2, version: 4 }
      ]
    })
    workspaceUser.role = 2
    const container = await mount()
    expect(container.querySelector('#workspace-link-1')?.textContent).toContain(
      '由网站管理，不能在这里修改'
    )
    expect(
      [...container.querySelectorAll('button')].some(
        (item) => item.textContent === '删除资源'
      )
    ).toBe(false)
    expect(button(container, '移除这条链接')).toBeDefined()
    expect(mocks.kunFetchDelete).not.toHaveBeenCalled()
  })

  it('does not let an ordinary author remove a touchgal slot', async () => {
    current = detail({
      links: [
        {
          id: 2,
          version: 4,
          storage: 'touchgal',
          protected: false,
          content: 'https://disk.example/a',
          code: '',
          password: 'disk-secret',
          hash: '',
          size: '1GB'
        },
        {
          id: 3,
          version: 1,
          storage: 'user',
          protected: false,
          content: 'https://user.example/a',
          code: '',
          password: '',
          hash: '',
          size: '1GB'
        }
      ],
      baseLinks: [
        { id: 2, version: 4 },
        { id: 3, version: 1 }
      ]
    })
    const container = await mount()
    // 普通作者看不到资源盘槽位的移除按钮，也没有无效报错路径
    const disk = container.querySelector('#workspace-link-2') as HTMLElement
    const userSlot = container.querySelector('#workspace-link-3') as HTMLElement
    expect(
      [...disk.querySelectorAll('button')].some((item) =>
        item.textContent?.includes('移除这条链接')
      )
    ).toBe(false)
    expect(
      [...userSlot.querySelectorAll('button')].some((item) =>
        item.textContent?.includes('移除这条链接')
      )
    ).toBe(true)
    expect(container.textContent).not.toContain('资源盘链接不能由普通作者删除')
    expect(
      container.querySelectorAll('input[aria-label="链接地址"]')
    ).toHaveLength(2)
    expect(
      (
        container.querySelector(
          'input[aria-label="解压码"]'
        ) as HTMLInputElement
      ).value
    ).toBe('disk-secret')
  })

  it('keeps an edit made during save, clears a consumed upload, and drops a late read', async () => {
    current = detail({
      links: [
        { id: 1, version: 1, storage: 'touchgal', protected: true },
        {
          id: 2,
          version: 4,
          storage: 's3',
          protected: false,
          content: 'https://origin.example/a',
          code: '',
          password: 'pw',
          hash: 'hash',
          size: '1GB'
        }
      ]
    })
    workspaceUser.role = 3
    const container = await mount()
    const size = container.querySelector(
      'input[aria-label="资源大小"]'
    ) as HTMLInputElement
    expect(size.readOnly).toBe(true)
    const file = new File(['abc'], 'game.zip', { type: 'application/zip' })
    const input = container.querySelector(
      'input[aria-label="上传资源文件"]'
    ) as HTMLInputElement
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    mocks.axiosPost.mockResolvedValue({
      data: {
        filetype: 's3',
        uploadId: 'up-1',
        fileHash: 'abc',
        fileSize: '9MB'
      }
    })
    await act(async () => {
      input.dispatchEvent(new dom!.window.Event('change', { bubbles: true }))
    })
    await settle()
    expect(size.value).toBe('9MB')

    let release: ((value: unknown) => void) | undefined
    mocks.kunFetchGet.mockImplementation((url: string) => {
      if (url === '/workspace/resources/9') {
        return new Promise((resolve) => {
          release = resolve
        })
      }
      return Promise.resolve(current)
    })
    mocks.kunFetchPut.mockResolvedValue({
      links: [
        { id: 1, version: 2 },
        { id: 2, version: 6 }
      ],
      linkChecks: []
    })
    await act(async () => {
      button(container, '保存')!.click()
    })
    const password = container.querySelector(
      'input[aria-label="解压码"]'
    ) as HTMLInputElement
    await act(async () => {
      setValue(password, 'during-save')
    })
    release!(
      detail({
        baseLinks: [
          { id: 1, version: 2 },
          { id: 2, version: 6 }
        ],
        links: [
          { id: 1, version: 2, storage: 'touchgal', protected: true },
          {
            id: 2,
            version: 6,
            storage: 's3',
            protected: false,
            content: 'https://canonical.example/file',
            code: '',
            password: 'saved-secret',
            hash: 'abc',
            size: '9MB'
          }
        ]
      })
    )
    await settle()
    expect(password.value).toBe('during-save')
    expect(
      (
        container.querySelector(
          'input[aria-label="链接地址"]'
        ) as HTMLInputElement
      ).value
    ).toBe('https://canonical.example/file')
    expect(size.readOnly).toBe(true)

    mocks.kunFetchGet.mockImplementation(async () => current)
    current = detail({
      baseLinks: [
        { id: 1, version: 2 },
        { id: 2, version: 6 }
      ],
      links: [
        { id: 1, version: 2, storage: 'touchgal', protected: true },
        {
          id: 2,
          version: 6,
          storage: 's3',
          protected: false,
          content: 'https://canonical.example/file',
          code: '',
          password: 'saved-secret',
          hash: 'abc',
          size: '9MB'
        }
      ]
    })
    await act(async () => {
      button(container, '保存')!.click()
    })
    await settle()
    const saved = mocks.kunFetchPut.mock.calls.at(-1)?.[1]
    expect(saved.links[1].uploadId).toBeUndefined()
    expect(saved.links[1].password).toBe('during-save')
    expect(saved.baseLinks).toEqual([
      { id: 1, version: 2 },
      { id: 2, version: 6 }
    ])

    const late: Array<(value: unknown) => void> = []
    mocks.kunFetchGet.mockImplementation((url: string) => {
      if (String(url).endsWith('/9')) {
        return new Promise((resolve) => {
          late.push(resolve)
        })
      }
      return Promise.resolve(detail({ id: 10, name: '资源乙' }))
    })
    await act(async () => {
      root!.render(
        <WorkspaceUserProvider user={{ ...workspaceUser, role: 3 }}>
          <WorkspaceResourceEditor resourceId={10} />
        </WorkspaceUserProvider>
      )
    })
    await settle()
    expect(
      (
        container.querySelector(
          'input[aria-label="资源名称"]'
        ) as HTMLInputElement
      ).value
    ).toBe('资源乙')
    late[0]?.('资源甲读取失败')
    await settle()
    expect(container.textContent).not.toContain('资源甲读取失败')
    expect(
      (
        container.querySelector(
          'input[aria-label="资源名称"]'
        ) as HTMLInputElement
      ).value
    ).toBe('资源乙')
  })

  it('confirms reload after an edit during save and reads directly when nothing changed in flight', async () => {
    const container = await mount()
    const name = container.querySelector(
      'input[aria-label="资源名称"]'
    ) as HTMLInputElement
    expect(name.value).toBe('资源甲')

    let release: ((value: unknown) => void) | undefined
    mocks.kunFetchGet.mockImplementation((url: string) => {
      if (url === '/workspace/resources/9') {
        return new Promise((resolve) => {
          release = resolve
        })
      }
      return Promise.resolve(current)
    })
    mocks.kunFetchPut.mockResolvedValue({
      links: [
        { id: 1, version: 2 },
        { id: 2, version: 5 }
      ],
      linkChecks: []
    })
    await act(async () => {
      button(container, '保存')!.click()
    })
    await act(async () => {
      setValue(name, '飞行中的名称')
    })
    const saved = detail({ name: '资源甲' })
    release!(saved)
    await settle()
    expect(mocks.kunFetchPut.mock.calls[0]?.[1].name).toBe('资源甲')
    expect(name.value).toBe('飞行中的名称')

    mocks.kunFetchGet.mockImplementation(async (url: string) => {
      if (url === '/auth/captcha') {
        return { images: [], sessionId: 'captcha-session' }
      }
      return current
    })
    current = saved
    const resourceReads = () =>
      mocks.kunFetchGet.mock.calls.filter(
        (call) => call[0] === '/workspace/resources/9'
      ).length
    const puts = () => mocks.kunFetchPut.mock.calls.length
    const readsAtReload = resourceReads()
    const putsAtReload = puts()
    await act(async () => {
      button(container, '载入最新版本')!.click()
    })
    await settle()
    const reloadDialog = dom!.window.document.querySelector(
      '[role="alertdialog"]'
    )
    expect(reloadDialog?.textContent).toContain('尚未保存的修改')
    expect(resourceReads()).toBe(readsAtReload)
    expect(puts()).toBe(putsAtReload)
    expect(name.value).toBe('飞行中的名称')

    await act(async () => {
      button(reloadDialog!, '取消')!.click()
    })
    await settle()
    expect(resourceReads()).toBe(readsAtReload)
    expect(puts()).toBe(putsAtReload)
    expect(name.value).toBe('飞行中的名称')
    expect(
      dom!.window.document.querySelector('[role="alertdialog"]')
    ).toBeNull()

    await act(async () => {
      button(container, '载入最新版本')!.click()
    })
    await settle()
    const confirmDialog = dom!.window.document.querySelector(
      '[role="alertdialog"]'
    )!
    expect(resourceReads()).toBe(readsAtReload)
    await act(async () => {
      button(confirmDialog, '确认')!.click()
    })
    await settle()
    expect(name.value).toBe('资源甲')
    expect(resourceReads()).toBe(readsAtReload + 1)
    expect(puts()).toBe(putsAtReload)

    current = detail({ name: '服务端新名称' })
    await act(async () => {
      button(container, '保存')!.click()
    })
    await settle()
    expect(name.value).toBe('服务端新名称')
    current = detail({ name: '再次读取' })
    const readsBeforeDirect = resourceReads()
    await act(async () => {
      button(container, '载入最新版本')!.click()
    })
    await settle()
    expect(
      dom!.window.document.querySelector('[role="alertdialog"]')
    ).toBeNull()
    expect(name.value).toBe('再次读取')
    expect(resourceReads()).toBe(readsBeforeDirect + 1)
  })

  it('keeps object-storage address, size, and checksum read-only and says protected links are site-managed', async () => {
    current = detail({
      links: [
        { id: 1, version: 1, storage: 'touchgal', protected: true },
        {
          id: 2,
          version: 4,
          storage: 's3',
          protected: false,
          content: 'https://origin.example/file',
          code: '',
          password: 'pw',
          hash: 'hash',
          size: '1GB'
        },
        {
          id: 3,
          version: 1,
          storage: 'user',
          protected: false,
          content: 'https://user.example/a',
          code: '',
          password: '',
          hash: 'user-hash',
          size: '2GB'
        }
      ],
      baseLinks: [
        { id: 1, version: 1 },
        { id: 2, version: 4 },
        { id: 3, version: 1 }
      ]
    })
    const container = await mount()
    const field = (linkId: number, label: string) =>
      container.querySelector(
        `#workspace-link-${linkId} input[aria-label="${label}"]`
      ) as HTMLInputElement | null
    // S3 地址/大小/校验只读
    for (const label of ['链接地址', '资源大小', '校验值']) {
      expect(field(2, label)?.readOnly).toBe(true)
    }
    // 外链不提供编辑校验
    expect(field(3, '校验值')).toBeNull()
    expect(field(3, '链接地址')?.readOnly).toBe(false)
    expect(field(3, '资源大小')?.readOnly).toBe(false)
    const managed = container.querySelector('#workspace-link-1')!
    expect(managed.textContent).toContain('由网站管理，不能在这里修改')
    expect(managed.textContent).not.toContain('编号')
    expect(managed.textContent).not.toContain('版本')
    expect(managed.textContent).not.toContain('提交')
  })

  it('scrolls a notification link once and stays put while typing', async () => {
    const container = await mount(9, 2)
    expect(scrolled.map((node) => (node as HTMLElement).id)).toEqual([
      'workspace-link-2'
    ])
    const name = container.querySelector(
      'input[aria-label="资源名称"]'
    ) as HTMLInputElement
    await act(async () => {
      setValue(name, '仍停在原处')
    })
    await act(async () => {
      setValue(name, '再改一次')
    })
    expect(scrolled.map((node) => (node as HTMLElement).id)).toEqual([
      'workspace-link-2'
    ])
    expect(name.value).toBe('再改一次')
  })

  it('refreshes link maintenance without replacing the draft, and cancel sends nothing', async () => {
    current = detail({ maintenance: [maintenanceItem()] })
    const container = await mount(9, 2)
    const link = container.querySelector('#workspace-link-2') as HTMLElement
    expect(link.textContent).toContain('回应')
    const name = container.querySelector(
      'input[aria-label="资源名称"]'
    ) as HTMLInputElement
    const password = container.querySelector(
      'input[aria-label="解压码"]'
    ) as HTMLInputElement
    await act(async () => {
      setValue(name, '草稿名称')
      setValue(password, 'kept-secret')
    })
    const readsBefore = mocks.kunFetchGet.mock.calls.filter(
      (call) => call[0] === '/workspace/resources/9'
    ).length
    await act(async () => {
      button(link, '回应')!.click()
    })
    const dialog = dom!.window.document.querySelector('[role="alertdialog"]')!
    await act(async () => {
      button(dialog, '取消')!.click()
    })
    expect(mocks.kunFetchPost).not.toHaveBeenCalled()
    expect(mocks.kunFetchPut).not.toHaveBeenCalled()
    expect(
      mocks.kunFetchGet.mock.calls.filter(
        (call) => call[0] === '/workspace/resources/9'
      )
    ).toHaveLength(readsBefore)

    // 取消后输入仍在会话里，重新打开弹窗时说明还在
    await act(async () => {
      button(link, '回应')!.click()
    })
    const reopened = dom!.window.document.querySelector('[role="alertdialog"]')!
    const note = reopened.querySelector(
      'textarea[aria-label="维护说明"]'
    ) as HTMLTextAreaElement
    const proto = Object.getOwnPropertyDescriptor(
      dom!.window.HTMLTextAreaElement.prototype,
      'value'
    )
    await act(async () => {
      proto?.set?.call(note, '已经换了地址')
      note.dispatchEvent(new dom!.window.Event('input', { bubbles: true }))
    })
    current = detail({
      name: '服务端名称',
      note: '服务端备注',
      baseLinks: [
        { id: 1, version: 9 },
        { id: 2, version: 9 }
      ],
      links: [
        { id: 1, version: 9, storage: 'touchgal', protected: true },
        {
          id: 2,
          version: 9,
          storage: 'user',
          protected: false,
          content: 'https://server.example/replaced',
          code: '',
          password: 'server-secret',
          hash: '',
          size: '9GB'
        }
      ],
      maintenance: [
        maintenanceItem({ state: 'handled', capabilities: { actions: [] } })
      ]
    })
    mocks.kunFetchPost.mockResolvedValue({ item: current.maintenance[0] })
    const confirm = dom!.window.document.querySelector('[role="alertdialog"]')!
    await act(async () => {
      button(confirm, '确认')!.click()
    })
    await settle()
    expect(mocks.kunFetchPost).toHaveBeenCalledTimes(1)
    expect(mocks.kunFetchPost).toHaveBeenCalledWith(
      '/workspace/maintenance',
      expect.objectContaining({
        action: 'respond',
        note: '已经换了地址',
        linkId: 2,
        linkVersion: 4,
        maintenanceRevision: 6
      })
    )
    expect(mocks.kunFetchPut).not.toHaveBeenCalled()
    expect(name.value).toBe('草稿名称')
    expect(password.value).toBe('kept-secret')
    expect(
      (
        container.querySelector(
          'input[aria-label="链接地址"]'
        ) as HTMLInputElement
      ).value
    ).toBe('https://origin.example/a')
    expect(link.textContent).not.toContain('回应')

    mocks.kunFetchPut.mockResolvedValue('保存被测试拦住')
    await act(async () => {
      button(container, '保存')!.click()
    })
    await settle()
    const saved = mocks.kunFetchPut.mock.calls.at(-1)?.[1]
    expect(saved.name).toBe('草稿名称')
    expect(saved.links[1].password).toBe('kept-secret')
    expect(saved.links[1].content).toBe('https://origin.example/a')
    expect(saved.baseLinks).toEqual([
      { id: 1, version: 1 },
      { id: 2, version: 4 }
    ])
    expect(name.value).toBe('草稿名称')
  })

  const chooseSelect = async (
    rootNode: ParentNode,
    label: string,
    value: string
  ) => {
    const select = rootNode.querySelector(
      `select[aria-label="${label}"]`
    ) as HTMLSelectElement
    const proto = Object.getOwnPropertyDescriptor(
      dom!.window.HTMLSelectElement.prototype,
      'value'
    )
    await act(async () => {
      proto?.set?.call(select, value)
      select.dispatchEvent(new dom!.window.Event('change', { bubbles: true }))
    })
  }

  const chooseUpload = async (rootNode: ParentNode, name = 'game.zip') => {
    const file = new File(['abc'], name, { type: 'application/zip' })
    const input = rootNode.querySelector(
      'input[aria-label="上传资源文件"]'
    ) as HTMLInputElement
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [file]
    })
    await act(async () => {
      input.dispatchEvent(new dom!.window.Event('change', { bubbles: true }))
    })
    return file
  }

  it('uploads from the draft section and keeps role 3 galgame uploads', async () => {
    workspaceUser.role = 2
    current = detail({
      capabilities: { canEdit: true, canDelete: true, canUpload: false }
    })
    const container = await mount()
    expect(container.textContent).not.toContain('上传到对象存储')
    await chooseSelect(container, '资源分区', 'patch')
    await chooseSelect(container, '存储类型', 's3')
    expect(button(container, '上传到对象存储')).toBeTruthy()
    await chooseSelect(container, '资源分区', 'galgame')
    expect(container.textContent).not.toContain('上传到对象存储')
    expect(
      (
        container.querySelector(
          'select[aria-label="存储类型"]'
        ) as HTMLSelectElement
      ).value
    ).toBe('s3')

    workspaceUser.role = 3
    current = detail({
      capabilities: { canEdit: true, canDelete: true, canUpload: false },
      links: [
        { id: 1, version: 1, storage: 'touchgal', protected: true },
        {
          id: 2,
          version: 4,
          storage: 's3',
          protected: false,
          content: 'https://origin.example/a',
          code: '',
          password: 'pw',
          hash: 'hash',
          size: '1GB'
        }
      ]
    })
    const role3 = await mount()
    expect(button(role3, '上传到对象存储')).toBeTruthy()
    const s3Option = [
      ...role3.querySelectorAll('select[aria-label="存储类型"] option')
    ].find((option) => (option as HTMLOptionElement).value === 's3') as
      | HTMLOptionElement
      | undefined
    expect(s3Option?.disabled).toBe(true)
  })

  it('merges a finished upload without restoring fields edited while it ran', async () => {
    workspaceUser.role = 3
    current = detail({
      links: [
        { id: 1, version: 1, storage: 'touchgal', protected: true },
        {
          id: 2,
          version: 4,
          storage: 's3',
          protected: false,
          content: 'https://origin.example/a',
          code: 'old-code',
          password: 'old-pw',
          hash: 'hash',
          size: '1GB'
        }
      ]
    })
    let resolveUpload: ((value: unknown) => void) | undefined
    mocks.axiosPost.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpload = resolve
        })
    )
    const container = await mount()
    await chooseUpload(container)
    const name = container.querySelector(
      'input[aria-label="资源名称"]'
    ) as HTMLInputElement
    const code = container.querySelector(
      'input[aria-label="提取码"]'
    ) as HTMLInputElement
    const password = container.querySelector(
      'input[aria-label="解压码"]'
    ) as HTMLInputElement
    await act(async () => {
      setValue(name, '上传期间的名称')
      setValue(code, 'new-code')
      setValue(password, 'new-pw')
    })
    resolveUpload?.({
      data: {
        filetype: 's3',
        uploadId: 'up-9',
        fileHash: 'abc',
        fileSize: '4MB'
      }
    })
    await settle()
    expect(name.value).toBe('上传期间的名称')
    expect(code.value).toBe('new-code')
    expect(password.value).toBe('new-pw')
    expect(
      (
        container.querySelector(
          'input[aria-label="校验值"]'
        ) as HTMLInputElement
      ).value
    ).toBe('abc')
    expect(
      (
        container.querySelector(
          'input[aria-label="资源大小"]'
        ) as HTMLInputElement
      ).value
    ).toBe('4MB')
  })

  it('drops a failed upload after a successful reload and keeps it when reload fails', async () => {
    workspaceUser.role = 3
    current = detail({
      links: [
        { id: 1, version: 1, storage: 'touchgal', protected: true },
        {
          id: 2,
          version: 4,
          storage: 's3',
          protected: false,
          content: 'https://origin.example/a',
          code: '',
          password: 'pw',
          hash: 'hash',
          size: '1GB'
        }
      ]
    })
    mocks.axiosPost.mockResolvedValueOnce({ data: '可用萌萌点不足' })
    const container = await mount()
    await chooseUpload(container, 'stuck.zip')
    await settle()
    expect(container.textContent).toContain('stuck.zip')
    expect(button(container, '重试上传')).toBeTruthy()

    mocks.kunFetchGet.mockImplementation(async (url: string) => {
      if (url === '/auth/captcha') {
        return { images: [], sessionId: 'captcha-session' }
      }
      return '读取失败'
    })
    await act(async () => {
      button(container, '载入最新版本')!.click()
    })
    await settle()
    expect(container.textContent).toContain('读取失败')
    expect(container.textContent).toContain('stuck.zip')

    mocks.kunFetchGet.mockImplementation(async (url: string) => {
      if (url === '/auth/captcha') {
        return { images: [], sessionId: 'captcha-session' }
      }
      return current
    })
    await act(async () => {
      button(container, '载入最新版本')!.click()
    })
    await settle()
    expect(container.textContent).not.toContain('stuck.zip')
    expect(button(container, '重试上传')).toBeUndefined()
    expect(
      (
        container.querySelector(
          'input[aria-label="解压码"]'
        ) as HTMLInputElement
      ).value
    ).toBe('pw')
  })

  it('blocks reload while captcha is open', async () => {
    workspaceUser.role = 2
    current = detail({
      section: 'patch',
      links: [
        { id: 1, version: 1, storage: 'touchgal', protected: true },
        {
          id: 2,
          version: 4,
          storage: 's3',
          protected: false,
          content: '',
          code: '',
          password: '',
          hash: '',
          size: ''
        }
      ]
    })
    mocks.kunFetchGet.mockImplementation(async (url: string) => {
      if (url === '/auth/captcha') {
        return { images: [], sessionId: 'captcha-session' }
      }
      return current
    })
    const container = await mount()
    const reads = mocks.kunFetchGet.mock.calls.length
    await chooseUpload(container)
    const reload = button(container, '载入最新版本') as HTMLButtonElement
    expect(reload.disabled).toBe(true)
    expect(dom!.window.document.body.textContent).toContain('人机验证')
    await act(async () => {
      reload.click()
    })
    expect(mocks.kunFetchGet.mock.calls.length).toBe(reads + 1)
  })

  it('shows required markers and the full type description', async () => {
    const container = await mount()
    const describedNote = (control: Element | null) => {
      const id = control?.getAttribute('aria-describedby')
      if (!id) return null
      return (
        [...container.querySelectorAll('span')].find(
          (item) => item.id === id
        ) ?? null
      )
    }
    for (const label of ['资源类型', '资源语言', '资源平台', '中文支持']) {
      const control = container.querySelector(`[aria-label="${label}"]`)
      expect(control?.tagName).toBe('BUTTON')
      expect(control?.getAttribute('role')).toBeNull()
      expect(control?.getAttribute('aria-label')).toBe(label)
      expect(control?.getAttribute('aria-required')).toBeNull()
      expect(describedNote(control)?.textContent?.trim()).toBe('必填')
    }
    const description = [...container.querySelectorAll('span')].find(
      (item) => item.textContent === '在 Windows, macOS 等电脑设备上运行的游戏'
    )
    expect(description).toBeTruthy()
    expect(description?.className ?? '').not.toContain('truncate')
    expect(description?.getAttribute('title')).toContain('Windows')
    expect(container.textContent).toContain('日本語')

    const toggle = async (name: string) => {
      const label = [...container.querySelectorAll('label')].find((item) =>
        item.textContent?.includes(name)
      )
      await act(async () => {
        label?.querySelector('input')?.click()
      })
    }
    await toggle('资料集')
    await toggle('PC游戏')
    const chinese = container.querySelector(
      '[aria-label="中文支持"]'
    ) as HTMLButtonElement
    expect(chinese.disabled).toBe(true)
    expect(chinese.getAttribute('aria-label')).toBe('中文支持')
    expect(chinese.getAttribute('aria-required')).toBeNull()
    expect(chinese.getAttribute('aria-describedby')).toBeNull()
    expect(describedNote(chinese)).toBeNull()
    const typeTrigger = container.querySelector('[aria-label="资源类型"]')
    expect(describedNote(typeTrigger)?.textContent?.trim()).toBe('必填')
    expect(container.textContent).toContain('日本語')
  })
})

describe('workspace resource upload', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    workspaceUser.role = 2
  })

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    root = undefined
    dom?.window.close()
    dom = undefined
    vi.unstubAllGlobals()
  })

  const mountUpload = async () => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost/workspace/resources/9'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const { createRoot } = await import('react-dom/client')
    const container = dom.window.document.getElementById('root')!
    root = createRoot(container)
    const uploaded = vi.fn()
    await act(async () => {
      root!.render(
        <WorkspaceUserProvider user={{ ...workspaceUser }}>
          <WorkspaceResourceUpload onUploaded={uploaded} />
        </WorkspaceUserProvider>
      )
    })
    return { container, uploaded }
  }

  const choose = async (container: HTMLElement, name = 'game.zip') => {
    const file = new File(['abc'], name, { type: 'application/zip' })
    const input = container.querySelector(
      'input[aria-label="上传资源文件"]'
    ) as HTMLInputElement
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    await act(async () => {
      input.dispatchEvent(new dom!.window.Event('change', { bubbles: true }))
    })
    await act(async () => {})
    return file
  }

  it('sends nothing when captcha is cancelled and keeps the file', async () => {
    mocks.kunFetchGet.mockResolvedValue({
      images: [],
      sessionId: 'captcha-session'
    })
    const { container } = await mountUpload()
    await choose(container)
    expect(container.textContent).toContain('game.zip')
    const cancel = [...dom!.window.document.querySelectorAll('button')].find(
      (item) => item.textContent?.includes('取消')
    )
    expect(cancel).toBeTruthy()
    await act(async () => {
      cancel!.click()
    })
    expect(mocks.axiosPost).not.toHaveBeenCalled()
    expect(mocks.kunFetchPost).not.toHaveBeenCalled()
    expect(container.textContent).toContain('game.zip')
  })

  it('keeps the selected file when the upload business error is a string and retries it', async () => {
    workspaceUser.role = 3
    mocks.axiosPost.mockResolvedValueOnce({ data: '可用萌萌点不足' })
    const { container } = await mountUpload()
    const file = await choose(container)
    expect(mocks.toast.error).toHaveBeenCalledWith('可用萌萌点不足')
    expect(container.textContent).toContain('game.zip')
    expect(mocks.axiosPost).toHaveBeenCalledTimes(1)
    mocks.axiosPost.mockResolvedValueOnce({
      data: {
        filetype: 's3',
        uploadId: 'up-2',
        fileHash: 'h',
        fileSize: '1MB'
      }
    })
    await act(async () => {
      ;[...container.querySelectorAll('button')]
        .find((item) => item.textContent?.includes('重试上传'))!
        .click()
    })
    await act(async () => {})
    expect(mocks.axiosPost).toHaveBeenCalledTimes(2)
    const form = mocks.axiosPost.mock.calls[1]?.[1] as FormData
    expect(form.get('file')).toBe(file)
  })
})
