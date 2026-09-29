import React, { act } from 'react'
import type { Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CaseDetail, CaseMessage } from '~/types/api/case'

const mocks = vi.hoisted(() => ({
  kunFetchGet: vi.fn(),
  user: { uid: 5, name: '报告者乙', role: 1 }
}))

vi.mock('~/utils/kunFetch', () => ({
  kunFetchGet: mocks.kunFetchGet,
  kunFetchPost: vi.fn(),
  kunFetchFormData: vi.fn()
}))
vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() })
}))
vi.mock('~/store/userStore', () => ({
  useUserStore: (selector: (state: { user: typeof mocks.user }) => unknown) =>
    selector({ user: mocks.user })
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() })
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

globalThis.React = React

// user.avatar 存的是图床上的完整地址，没上传过头像时是空串
const AVATAR = 'https://img.example/user/avatar/user_2/avatar-mini.avif?v=m3'

const note = (
  id: number,
  author: CaseMessage['author'],
  extra: Partial<CaseMessage> = {}
): CaseMessage => ({
  id,
  kind: 'reply',
  event: null,
  body: `第 ${id} 条对话`,
  author,
  payload: null,
  created: `2026-09-13T0${id}:00:00.000Z`,
  ...extra
})

const makeDetail = (overrides: Partial<CaseDetail>): CaseDetail => ({
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
  owner: { id: 2, name: '发布者甲', avatar: AVATAR },
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
  messages: [],
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

describe('case dialogue avatars', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.user = { uid: 5, name: '报告者乙', role: 1 }
  })

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    root = undefined
    dom = undefined
    vi.unstubAllGlobals()
  })

  // Radix Avatar 在模块加载时看 document 在不在来判断是否身处浏览器，不在就不探测
  // 图片，所以先搭好 DOM 再导入组件。探测到图片加载成功后它才渲染 <img>，而 jsdom
  // 从不加载图片：loadImages 让每张图都像命中缓存一样立即报告加载完成。
  const setup = async ({ loadImages = false } = {}) => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })
    if (loadImages) {
      const image = dom.window.HTMLImageElement.prototype
      Object.defineProperty(image, 'complete', { get: () => true })
      Object.defineProperty(image, 'naturalWidth', { get: () => 64 })
    }
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const [{ createRoot }, { IssueCaseDetail }, { DashboardCaseDetail }] =
      await Promise.all([
        import('react-dom/client'),
        import('~/components/dashboard/issue/IssueCaseDetail'),
        import('~/components/dashboard/case/DashboardCaseDetail')
      ])
    const mount = async (ui: React.ReactElement) => {
      const container = dom!.window.document.getElementById('root')!
      root = createRoot(container)
      await act(async () => {
        root!.render(ui)
      })
      await act(async () => {})
      return container
    }
    return { mount, IssueCaseDetail, DashboardCaseDetail }
  }

  /** One entry per dialogue row; system events carry no avatar. */
  const avatarsIn = (list: Element) =>
    [...list.querySelectorAll(':scope > li')].map((row) =>
      row.querySelector<HTMLElement>('[data-slot="avatar"]')
    )

  const fallbackOf = (avatar: HTMLElement) =>
    avatar.querySelector<HTMLElement>('[data-slot="avatar-fallback"]')

  it('shows a loaded avatar in /issue and the initial colored by side otherwise', async () => {
    mocks.kunFetchGet.mockResolvedValue({
      case: makeDetail({
        reporter: { id: 5, name: '报告者乙', avatar: '' },
        messages: [
          note(1, { id: 5, name: '报告者乙', avatar: '' }),
          note(2, { id: 2, name: '发布者甲', avatar: AVATAR }),
          note(3, { id: 1, name: '站长', avatar: '' }, { authorSide: 'staff' }),
          note(4, null)
        ]
      })
    })
    const { mount, IssueCaseDetail } = await setup({ loadImages: true })
    const container = await mount(<IssueCaseDetail caseId={9} />)

    const [reporter, publisher, staff, deleted] = avatarsIn(
      container.querySelector('ol[aria-label="沟通记录"]')!
    ).map((avatar) => avatar!)
    // 名字已经以文字出现，头像只作装饰
    expect(publisher.getAttribute('aria-hidden')).toBe('true')
    const image = publisher.querySelector('img')
    expect(image?.getAttribute('src')).toBe(AVATAR)
    expect(image?.getAttribute('alt')).toBe('')
    expect(fallbackOf(publisher)).toBeNull()

    expect(reporter.querySelector('img')).toBeNull()
    expect(reporter.textContent).toBe('报')
    expect(fallbackOf(reporter)!.className).toContain('bg-muted')
    expect(fallbackOf(reporter)!.className).not.toContain('bg-primary')
    // 处理方一侧用主色，盖掉官方回退的灰底
    expect(staff.textContent).toBe('站')
    expect(fallbackOf(staff)!.className).toContain('bg-primary')
    expect(fallbackOf(staff)!.className).not.toContain('bg-muted')
    // 能识别报告者的视角里 author 为 null 只能是注销账号，不属于任何一侧
    expect(deleted.textContent).toBe('已')
    expect(fallbackOf(deleted)!.className).toContain('border-dashed')
    expect(fallbackOf(deleted)!.className).not.toContain('bg-muted')
  })

  it('keeps the initial in /issue until the avatar image has loaded', async () => {
    mocks.user = { uid: 2, name: '发布者甲', role: 1 }
    // 发布者的视角不识别报告者：详情不带 reporter 键，报告者的 author 被隐去
    mocks.kunFetchGet.mockResolvedValue({
      case: makeDetail({
        messages: [
          note(1, null),
          note(
            2,
            { id: 2, name: '发布者甲', avatar: AVATAR },
            { authorSide: 'publisher' }
          )
        ]
      })
    })
    // 不模拟加载：图片仍在加载或加载失败
    const { mount, IssueCaseDetail } = await setup()
    const container = await mount(<IssueCaseDetail caseId={9} />)

    const [reporter, publisher] = avatarsIn(
      container.querySelector('ol[aria-label="沟通记录"]')!
    ).map((avatar) => avatar!)
    expect(publisher.querySelector('img')).toBeNull()
    expect(publisher.textContent).toBe('发')
    expect(fallbackOf(publisher)!.className).toContain('bg-primary')
    // 被隐去身份的报告者不是注销账号，不画虚线
    expect(reporter.textContent).toBe('报')
    expect(fallbackOf(reporter)!.className).not.toContain('border-dashed')
  })

  it('shows a loaded avatar in the dashboard and colors initials by side', async () => {
    mocks.kunFetchGet.mockResolvedValue({
      case: makeDetail({
        ownerType: 'staff',
        owner: null,
        reporter: { id: 5, name: '举报人', avatar: '' },
        messages: [
          note(1, { id: 5, name: '举报人', avatar: '' }),
          note(
            2,
            { id: 1, name: '站长', avatar: AVATAR },
            { authorSide: 'staff' }
          ),
          note(
            3,
            { id: 3, name: '值班管理员', avatar: '' },
            { authorSide: 'staff' }
          ),
          note(4, { id: 6, name: '关注者', avatar: '' }, { kind: 'report' }),
          note(5, null),
          note(6, null, { kind: 'system', event: 'escalated', body: '' })
        ]
      })
    })
    const { mount, DashboardCaseDetail } = await setup({ loadImages: true })
    const container = await mount(<DashboardCaseDetail caseId={9} />)

    const [reporter, staff, onDuty, follower, deleted, system] = avatarsIn(
      container.querySelector('section[aria-label="沟通记录"] ol')!
    )
    // 系统事件不是谁写的，不画头像
    expect(system).toBeNull()
    expect(staff!.getAttribute('aria-hidden')).toBe('true')
    expect(staff!.getAttribute('data-size')).toBe('sm')
    const image = staff!.querySelector('img')
    expect(image?.getAttribute('src')).toBe(AVATAR)
    expect(image?.getAttribute('alt')).toBe('')
    expect(fallbackOf(staff!)).toBeNull()

    // 按报告者 id 区分：报告者本人与其他报告者用灰色，处理方用主色
    expect(reporter!.textContent).toBe('举')
    expect(fallbackOf(reporter!)!.className).not.toContain('bg-primary')
    expect(follower!.textContent).toBe('关')
    expect(fallbackOf(follower!)!.className).not.toContain('bg-primary')
    expect(onDuty!.textContent).toBe('值')
    expect(fallbackOf(onDuty!)!.className).toContain('bg-primary')
    expect(deleted!.textContent).toBe('已')
    expect(fallbackOf(deleted!)!.className).toContain('border-dashed')
  })
})
