import React, { act } from 'react'
import type { Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  LinkCheckResponse,
  LinkCheckProvider,
  LinkCheckSummary,
  LinkHealthView
} from '~/types/api/linkHealth'
import type { PatchResourceHealthLink } from '~/types/api/patch'

const mocks = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
  post: vi.fn()
}))
vi.mock('react-hot-toast', () => ({ default: mocks.toast }))
vi.mock('~/utils/kunFetch', () => ({ kunFetchPost: mocks.post }))
vi.mock('@heroui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children
}))
vi.mock('@heroui/react', async () => {
  const { useState } = await import('react')
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  )
  return {
    Modal: ({
      isOpen,
      children
    }: {
      isOpen: boolean
      children: React.ReactNode
    }) => (isOpen ? <div role="dialog">{children}</div> : null),
    ModalContent: Wrapper,
    ModalHeader: Wrapper,
    ModalBody: Wrapper,
    ModalFooter: Wrapper,
    Button: ({
      children,
      onPress,
      isDisabled,
      isLoading,
      ...props
    }: {
      children: React.ReactNode
      onPress?: () => void
      isDisabled?: boolean
      isLoading?: boolean
      'aria-label'?: string
    }) => (
      <button
        aria-label={props['aria-label']}
        disabled={isDisabled || isLoading}
        onClick={onPress}
      >
        {children}
      </button>
    ),
    useDisclosure: () => {
      const [isOpen, setOpen] = useState(false)
      return {
        isOpen,
        onOpen: () => setOpen(true),
        onClose: () => setOpen(false)
      }
    }
  }
})
vi.mock('~/components/dashboard/ui/alert-dialog', () => {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  )
  return {
    AlertDialog: ({
      open,
      children
    }: {
      open: boolean
      children: React.ReactNode
    }) => (open ? <div role="alertdialog">{children}</div> : null),
    AlertDialogContent: Wrapper,
    AlertDialogHeader: Wrapper,
    AlertDialogTitle: Wrapper,
    AlertDialogDescription: Wrapper,
    AlertDialogFooter: Wrapper,
    AlertDialogCancel: ({
      children,
      disabled
    }: {
      children: React.ReactNode
      disabled: boolean
    }) => <button disabled={disabled}>{children}</button>,
    AlertDialogAction: ({
      children,
      disabled,
      onClick
    }: {
      children: React.ReactNode
      disabled: boolean
      onClick: React.MouseEventHandler<HTMLButtonElement>
    }) => (
      <button disabled={disabled} onClick={onClick}>
        {children}
      </button>
    )
  }
})

import { LinkHealthActions } from '~/components/patch/resource/LinkHealthActions'
import { LinkHealthCaseActions } from '~/components/dashboard/case/LinkHealthCaseActions'

globalThis.React = React

const summary = (overrides: Record<string, unknown> = {}): LinkCheckSummary =>
  ({
    provider: 'quark',
    verdict: 'available',
    reason: 'share_available',
    failed: false,
    checkedAt: '2026-10-16T00:00:01.000Z',
    attemptedAt: '2026-10-16T00:00:00.000Z',
    stale: false,
    ...overrides
  }) as LinkCheckSummary

const view = (overrides: Partial<LinkHealthView> = {}): LinkHealthView => ({
  patchId: 3,
  resourceId: 7,
  linkId: 21,
  version: 2,
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
    canCheck: true,
    canEdit: false,
    ownerActions: [],
    resolveActions: []
  },
  ...overrides
})

const response = (
  result: LinkCheckSummary = summary(),
  overrides: Partial<LinkHealthView> = {}
): LinkCheckResponse & { result: LinkCheckSummary } => ({
  link: view({ latestCheck: result, ...overrides }),
  changed: false,
  check: result.failed ? 'failed' : 'observed',
  result
})

const failed = (reason: string, provider: LinkCheckProvider | null = 'quark') =>
  summary({
    verdict: 'unknown',
    failed: true,
    checkedAt: null,
    reason,
    provider
  })

const scenarios = [
  {
    name: 'available',
    data: response(),
    kind: 'success',
    text: '检测端可访问'
  },
  {
    name: 'deleted',
    data: response(summary({ verdict: 'broken', reason: 'share_deleted' }), {
      health: 'broken'
    }),
    kind: 'error',
    text: '检测确认失效：分享已删除'
  },
  {
    name: 'cancelled',
    data: response(summary({ verdict: 'broken', reason: 'share_cancelled' }), {
      health: 'broken'
    }),
    kind: 'error',
    text: '检测确认失效：分享已取消'
  },
  {
    name: 'expired',
    data: response(summary({ verdict: 'broken', reason: 'share_expired' }), {
      health: 'broken'
    }),
    kind: 'error',
    text: '检测确认失效：分享已过期'
  },
  {
    name: 'blocked',
    data: response(summary({ verdict: 'broken', reason: 'share_blocked' }), {
      health: 'broken'
    }),
    kind: 'error',
    text: '检测确认失效：分享已屏蔽'
  },
  {
    name: 'unsupported Baidu',
    data: response(failed('unsupported', 'baidu')),
    kind: 'info',
    text: '本站暂未支持百度网盘链接检测，无法判断链接状态'
  },
  {
    name: 'unrecognized provider',
    data: response(failed('unsupported', null)),
    kind: 'info',
    text: '本站暂未支持此类链接检测，无法判断链接状态'
  },
  {
    name: 'timeout',
    data: response(failed('timeout')),
    kind: 'error',
    text: '检测超时，暂时无法判断链接状态，请稍后重试'
  },
  {
    name: 'rate limited',
    data: response(failed('rate_limited')),
    kind: 'error',
    text: '检测服务请求过于频繁，请稍后重试'
  },
  {
    name: 'unavailable',
    data: response(failed('unavailable')),
    kind: 'error',
    text: '检测服务暂时不可用，无法判断链接状态，请稍后重试'
  },
  {
    name: 'invalid provider response',
    data: response(failed('invalid_response')),
    kind: 'error',
    text: '检测服务响应异常，无法判断链接状态，请稍后重试'
  },
  {
    name: 'untrusted result',
    data: response(failed('untrusted_result')),
    kind: 'error',
    text: '检测结果未通过校验，无法判断链接状态，请稍后重试'
  },
  {
    name: 'access verification',
    data: response(
      summary({ verdict: 'unknown', reason: 'access_unverified' })
    ),
    kind: 'info',
    text: '分享受限或需要访问验证，暂时无法判断链接状态'
  },
  {
    name: 'captcha or login required',
    data: response(failed('access_unverified')),
    kind: 'info',
    text: '分享受限或需要访问验证，暂时无法判断链接状态'
  },
  {
    name: 'stale result',
    data: response(summary({ stale: true })),
    kind: 'info',
    text: '检测结果已过期，请重新检测'
  },
  {
    name: 'machine/user dispute',
    data: response(summary(), {
      health: 'disputed',
      disputeSource: 'machine_user_conflict'
    }),
    kind: 'info',
    text: '检测端可访问，但链接仍有争议，需要继续复核'
  },
  {
    name: 'existing broken conclusion',
    data: response(summary(), { health: 'broken' }),
    kind: 'info',
    text: '检测端可访问，但链接仍标记为已失效，请核实后处理'
  },
  {
    name: 'existing suspect conclusion',
    data: response(summary(), { health: 'suspect' }),
    kind: 'info',
    text: '检测端可访问，但链接仍待核实'
  },
  {
    name: 'newer concurrent result',
    data: response(summary(), { latestCheck: failed('timeout') }),
    kind: 'info',
    text: '本次检测结果已被更新，请查看最新检测信息'
  },
  {
    name: 'missing attempt result',
    data: { ...response(), result: undefined },
    kind: 'error',
    text: '未取得有效检测结果，请刷新后重试'
  },
  {
    name: 'missing observation time',
    data: response(summary({ checkedAt: null })),
    kind: 'error',
    text: '未取得有效检测结果，请刷新后重试'
  },
  {
    name: 'inconsistent failure marker',
    data: { ...response(), check: 'failed' },
    kind: 'error',
    text: '未取得有效检测结果，请刷新后重试'
  }
] as const

describe.each(['resource', 'case'] as const)(
  '%s manual checker feedback',
  (surface) => {
    let root: Root | undefined
    let dom: JSDOM
    const onChanged = vi.fn()
    const render = (current: LinkHealthView = view()) =>
      surface === 'case' ? (
        <LinkHealthCaseActions linkHealth={current} onChanged={onChanged} />
      ) : (
        <LinkHealthActions
          patchId={current.patchId}
          resourceId={current.resourceId}
          link={
            {
              ...current,
              id: current.linkId,
              storage: 'user',
              size: '1 GB',
              hash: '',
              sortOrder: 0,
              download: 0
            } as PatchResourceHealthLink
          }
          group="maintain"
          onChanged={onChanged}
        />
      )

    beforeEach(async () => {
      vi.clearAllMocks()
      dom = new JSDOM('<!doctype html><div id="root"></div>', {
        url: 'http://localhost'
      })
      vi.stubGlobal('window', dom.window)
      vi.stubGlobal('document', dom.window.document)
      vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
      const { createRoot } = await import('react-dom/client')
      root = createRoot(dom.window.document.getElementById('root')!)
      await act(async () => {
        root!.render(render())
      })
    })
    afterEach(() => {
      act(() => root?.unmount())
      root = undefined
      dom.window.close()
      vi.unstubAllGlobals()
    })
    const click = async (name: string) => {
      const button = [...document.querySelectorAll('button')].find(
        (item) =>
          item.getAttribute('aria-label') === name || item.textContent === name
      )!
      expect(button).toBeDefined()
      await act(async () => button.click())
    }
    const submit = async () => {
      await click('检测链接')
      await click('确认')
    }

    it.each(scenarios)(
      'reports $name using the actual checker outcome',
      async ({ data, kind, text }) => {
        mocks.post.mockResolvedValue(data)
        await submit()
        const expectedToast = kind === 'info' ? mocks.toast : mocks.toast[kind]
        expect(expectedToast).toHaveBeenCalledWith(text)
        expect(mocks.toast.success).not.toHaveBeenCalledWith('检测完成')
        expect(onChanged).toHaveBeenCalledTimes(1)
        expect(
          document.querySelector('[role="dialog"], [role="alertdialog"]')
        ).toBeNull()
      }
    )

    it.each([
      null,
      undefined,
      {},
      { ...response(), link: view({ linkId: 99 }) }
    ])(
      'rejects missing or foreign-target responses without changing the current link',
      async (data) => {
        mocks.post.mockResolvedValue(data)
        await submit()
        expect(mocks.toast.error).toHaveBeenCalledWith(
          '未取得有效检测结果，请刷新后重试'
        )
        expect(mocks.toast.success).not.toHaveBeenCalled()
        expect(onChanged).not.toHaveBeenCalled()
      }
    )

    it('does not mistake an older successful projection for this failed attempt', async () => {
      mocks.post.mockResolvedValue(
        response(failed('timeout'), { latestCheck: summary() })
      )
      await submit()
      expect(mocks.toast.success).not.toHaveBeenCalled()
      expect(mocks.toast.error).toHaveBeenCalledWith(
        '检测超时，暂时无法判断链接状态，请稍后重试'
      )
    })

    it('reports a rejected HTTP request without claiming a link verdict', async () => {
      mocks.post.mockRejectedValue(new Error('fixture request failed'))
      await submit()
      expect(mocks.toast.error).toHaveBeenCalledWith(
        '网络错误，操作失败，请重试'
      )
      expect(mocks.toast.success).not.toHaveBeenCalled()
      expect(onChanged).not.toHaveBeenCalled()
    })

    it.each([
      '请先登录后再操作',
      '您没有权限操作该链接',
      '操作过于频繁，请稍后重试',
      '该链接已更新，请刷新后重试',
      '该链接的处理状态已变化，请刷新后重试'
    ])('preserves the API business error: %s', async (message) => {
      mocks.post.mockResolvedValue(message)
      await submit()
      expect(mocks.toast.error).toHaveBeenCalledWith(message)
      expect(mocks.toast.success).not.toHaveBeenCalled()
      expect(onChanged).not.toHaveBeenCalled()
      expect(mocks.post).toHaveBeenCalledTimes(1)
    })

    it('sends only one request while confirmation is already in flight', async () => {
      let resolve: (data: unknown) => void = () => {}
      mocks.post.mockImplementation(
        () =>
          new Promise((done) => {
            resolve = done
          })
      )
      await submit()
      await click('确认')
      expect(mocks.post).toHaveBeenCalledTimes(1)
      await act(async () => resolve(response()))
      expect(mocks.toast.success).toHaveBeenCalledWith('检测端可访问')
    })

    it('discards feedback after unmount', async () => {
      let resolve: (data: unknown) => void = () => {}
      mocks.post.mockImplementation(
        () =>
          new Promise((done) => {
            resolve = done
          })
      )
      await submit()
      act(() => root!.unmount())
      root = undefined
      await act(async () => resolve(response()))
      expect(mocks.toast).not.toHaveBeenCalled()
      expect(mocks.toast.success).not.toHaveBeenCalled()
      expect(mocks.toast.error).not.toHaveBeenCalled()
      expect(onChanged).not.toHaveBeenCalled()
    })

    it('discards late feedback after a new read snapshot arrives', async () => {
      let resolve: (data: unknown) => void = () => {}
      mocks.post.mockImplementation(
        () =>
          new Promise((done) => {
            resolve = done
          })
      )
      await submit()
      await act(async () => {
        root!.render(render(view({ recentReportCount: 9 })))
      })
      await act(async () => resolve(response()))
      expect(mocks.toast).not.toHaveBeenCalled()
      expect(mocks.toast.success).not.toHaveBeenCalled()
      expect(mocks.toast.error).not.toHaveBeenCalled()
      expect(onChanged).not.toHaveBeenCalled()
    })
  }
)
