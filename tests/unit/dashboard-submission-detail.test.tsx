import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminPatchSubmissionDetail } from '~/app/api/admin/patch-submission/service'
import type { PatchSubmissionCompanyDiagnostics } from '~/app/api/patch-submission/publishPreview'
import type { CompanyCandidate } from '~/app/api/company/identity/types'
import type { InboxItem } from '~/types/api/inbox'
import { PATCH_SUBMISSION_REVIEW_STATE_CHANGED_MESSAGE } from '~/constants/patchSubmission'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  onProcessed: vi.fn(),
  onStateChanged: vi.fn()
}))
vi.mock('~/utils/kunFetch', () => ({
  kunFetchGet: mocks.get,
  kunFetchPost: mocks.post
}))

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
vi.mock('~/components/dashboard/ui/alert-dialog', async () => {
  const ReactModule = await import('react')
  const Context = ReactModule.createContext({
    onOpenChange: (_open: boolean) => {}
  })
  const Block = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  )
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
      <Context.Provider value={{ onOpenChange }}>
        {open ? children : null}
      </Context.Provider>
    ),
    AlertDialogContent: ({ children }: { children?: React.ReactNode }) => {
      const { onOpenChange } = ReactModule.useContext(Context)
      return (
        <div
          role="alertdialog"
          onKeyDown={(event) => {
            if (event.key === 'Escape') onOpenChange(false)
          }}
        >
          {children}
        </div>
      )
    },
    AlertDialogCancel: ({
      children,
      disabled
    }: {
      children?: React.ReactNode
      disabled?: boolean
    }) => {
      const { onOpenChange } = ReactModule.useContext(Context)
      return (
        <button disabled={disabled} onClick={() => onOpenChange(false)}>
          {children}
        </button>
      )
    },
    AlertDialogHeader: Block,
    AlertDialogTitle: Block,
    AlertDialogDescription: Block,
    AlertDialogFooter: Block
  }
})

import { SubmissionInboxDetail } from '~/components/dashboard/inbox/SubmissionInboxDetail'

const candidate: CompanyCandidate = {
  source: 'vndb',
  externalId: 'p7',
  name: '候选会社',
  aliases: [],
  roles: [],
  sourceRoles: [],
  entityType: 'company',
  externalUrls: [],
  primaryLanguage: 'ja',
  sourceWebsites: []
}
const diagnostics = (
  overrides: Partial<PatchSubmissionCompanyDiagnostics> = {}
): PatchSubmissionCompanyDiagnostics => ({
  resolvedExisting: [],
  wouldCreate: [],
  ambiguities: [],
  diagnostics: [],
  snapshotDiagnostics: [],
  ...overrides
})
const detail = (
  overrides: Partial<AdminPatchSubmissionDetail> = {}
): AdminPatchSubmissionDetail => ({
  id: 1,
  status: 'pending',
  name: '月光投稿',
  payloadVersion: 1,
  heldAmount: 10,
  roleAtCreation: 1,
  externalSource: 'vndb',
  externalFetchedAt: null,
  reviewReason: null,
  reviewedAt: null,
  reviewedBy: null,
  submittedAt: '2026-09-01T00:00:00.000Z',
  created: '2026-09-01T00:00:00.000Z',
  author: { id: 7, name: '投稿人', avatar: '' },
  preview: {
    name: '月光投稿',
    introduction: '正文',
    introductionHtml: '<p>正文</p>',
    aliases: [],
    tagNames: [],
    companyNames: [],
    officialUrl: '',
    released: 'unknown',
    contentLimit: 'sfw',
    externalIds: {
      vndbId: 'v1',
      vndbRelationId: '',
      bangumiId: '',
      steamId: '',
      dlsiteCode: ''
    },
    bannerUrl: null,
    bannerOriginalUrl: null,
    gallery: []
  },
  vndbDuplicates: [],
  duplicatesTruncated: false,
  duplicateConfirmed: false,
  publishedPatch: null,
  ...overrides
})
const item = (
  id = 1,
  updated = '2026-09-01T00:00:00.000Z'
): Extract<InboxItem, { kind: 'submission' }> => ({
  key: `submission:${id}`,
  kind: 'submission',
  id,
  title: `投稿 ${id}`,
  subtitle: '投稿人',
  actor: { id: 7, name: '投稿人' },
  waitingFrom: updated,
  waitingSeconds: 60,
  targetHref: `/admin/submission/${id}`,
  badges: ['投稿'],
  readOnly: false,
  payload: {
    id,
    status: 'pending',
    name: `投稿 ${id}`,
    authorName: '投稿人',
    authorId: 7,
    submittedAt: updated,
    reviewedAt: null,
    updated,
    created: updated
  }
})

type Deferred<T> = {
  resolve: (value: T) => void
  reject: (error: Error) => void
}
type GetRequest = Deferred<AdminPatchSubmissionDetail | string> & {
  path: string
}
type PostRequest = Deferred<Record<string, unknown> | string> & {
  path: string
  body: Record<string, unknown>
}

describe('dashboard submission review detail', () => {
  let dom: JSDOM
  let root: Root
  let loads: GetRequest[]
  let writes: PostRequest[]

  beforeEach(() => {
    vi.resetAllMocks()
    loads = []
    writes = []
    mocks.get.mockImplementation(
      (path: string) =>
        new Promise((resolve, reject) => {
          loads.push({ path, resolve, reject })
        })
    )
    mocks.post.mockImplementation(
      (path: string, body: Record<string, unknown>) =>
        new Promise((resolve, reject) => {
          writes.push({ path, body, resolve, reject })
        })
    )
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'https://example.com/dashboard'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    root = createRoot(dom.window.document.getElementById('root')!)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    vi.unstubAllGlobals()
  })

  const render = async (row = item(), reviewerRole = 3, reviewerId = 9) => {
    await act(async () => {
      root.render(
        <SubmissionInboxDetail
          item={row}
          reviewerId={reviewerId}
          reviewerRole={reviewerRole}
          onProcessed={mocks.onProcessed}
          onStateChanged={mocks.onStateChanged}
        />
      )
    })
  }
  const mount = async (value = detail(), reviewerRole = 3, reviewerId = 9) => {
    await render(item(value.id), reviewerRole, reviewerId)
    await act(async () => {
      loads.at(-1)!.resolve(value)
    })
  }
  const button = (text: string) => {
    const found = [...dom.window.document.querySelectorAll('button')].find(
      (entry) => entry.textContent?.trim() === text
    )
    expect(found, `button ${text}`).toBeDefined()
    return found!
  }
  const click = async (text: string) => {
    await act(async () => {
      button(text).click()
    })
  }
  const fillReason = async (value: string) => {
    const textarea = dom.window.document.querySelector('textarea')!
    await act(async () => {
      textarea.value = value
      textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
  }
  const settle = async (value: Record<string, unknown> | string, index = 0) => {
    await act(async () => {
      writes[index].resolve(value)
    })
  }
  const dialog = () => dom.window.document.querySelector('[role="alertdialog"]')
  const text = () => dom.window.document.body.textContent ?? ''

  it('approves with one click using the selected submission ID, without a confirmation dialog', async () => {
    await mount()
    expect(loads[0].path).toBe('/admin/patch-submission/1')
    await click('通过并发布')
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({
      path: '/admin/patch-submission/approve',
      body: { submissionId: 1, overrideSelfReview: false }
    })
    expect(writes[0].body).not.toHaveProperty('reason')
    expect(dialog()).toBeNull()
    await settle({})
    expect(mocks.onProcessed).toHaveBeenCalledExactlyOnceWith('submission:1')
    expect(mocks.onStateChanged).not.toHaveBeenCalled()
  })

  it.each(['要求修改', '驳回', '违规处理'])(
    'requires a nonblank reason before %s',
    async (action) => {
      await mount()
      await fillReason('  ')
      await click(action)
      expect(writes).toHaveLength(0)
      expect(dialog()).toBeNull()
      expect(
        dom.window.document.querySelector('[role="alert"]')?.textContent
      ).toMatch(/原因|意见/)
    }
  )

  it.each([
    ['要求修改', 'request-changes'],
    ['驳回', 'reject']
  ])(
    'sends the trimmed reason for %s without an extra confirmation',
    async (label, action) => {
      await mount()
      await fillReason('  请补齐游戏资料  ')
      await click(label)
      expect(writes[0]).toMatchObject({
        path: `/admin/patch-submission/${action}`,
        body: {
          submissionId: 1,
          reason: '请补齐游戏资料',
          overrideSelfReview: false
        }
      })
      expect(dialog()).toBeNull()
      await settle({})
      expect(mocks.onProcessed).toHaveBeenCalledExactlyOnceWith('submission:1')
    }
  )

  it('requires exactly one violation confirmation and blocks duplicate writes while it is in flight', async () => {
    await mount()
    await fillReason('  投稿含违规内容  ')
    await click('违规处理')
    expect(writes).toHaveLength(0)
    expect(dialog()).not.toBeNull()
    expect(dialog()?.textContent).toContain('10')
    expect(dialog()?.textContent).toContain('不可撤销')
    const confirm = button('确认违规处理')
    await act(async () => {
      confirm.click()
      confirm.click()
    })
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({
      path: '/admin/patch-submission/violate',
      body: {
        submissionId: 1,
        reason: '投稿含违规内容',
        overrideSelfReview: false
      }
    })
    expect(button('取消').disabled).toBe(true)
    await act(async () => {
      dialog()?.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true
        })
      )
    })
    expect(dialog()).not.toBeNull()
    await settle({})
    expect(dialog()).toBeNull()
    expect(mocks.onProcessed).toHaveBeenCalledExactlyOnceWith('submission:1')
  })

  it('cancels violation confirmation without making a write', async () => {
    await mount()
    await fillReason('违规内容')
    await click('违规处理')
    await click('取消')
    expect(dialog()).toBeNull()
    expect(writes).toHaveLength(0)
  })

  it('blocks all review actions when a role 3 administrator is the author', async () => {
    await mount(detail(), 3, 7)
    expect(text()).toContain('不能审核自己的投稿')
    for (const label of ['通过并发布', '要求修改', '驳回', '违规处理']) {
      expect(button(label).disabled).toBe(true)
      await click(label)
    }
    expect(writes).toHaveLength(0)
    expect(
      dom.window.document.querySelector('input[type="checkbox"]')
    ).toBeNull()
  })

  it('requires the author with role 4 to explicitly enable self-review and submits that override', async () => {
    await mount(detail(), 4, 7)
    expect(button('通过并发布').disabled).toBe(true)
    const checkbox = dom.window.document.querySelector<HTMLInputElement>(
      'input[type="checkbox"]'
    )!
    expect(checkbox.checked).toBe(false)
    await act(async () => {
      checkbox.click()
    })
    expect(button('通过并发布').disabled).toBe(false)
    await click('通过并发布')
    expect(writes[0].body).toMatchObject({
      submissionId: 1,
      overrideSelfReview: true
    })
  })

  it('blocks approval when the publish preview is unavailable while leaving reason-based reviews available', async () => {
    await mount(detail({ preview: null }))
    expect(button('通过并发布').disabled).toBe(true)
    expect(button('要求修改').disabled).toBe(false)
    expect(button('驳回').disabled).toBe(false)
    expect(dom.window.document.querySelector('iframe')).toBeNull()
    await click('通过并发布')
    expect(writes).toHaveLength(0)
  })

  it('shows the real conflicting company IDs and blocks approval for a company ambiguity', async () => {
    await mount(
      detail({
        preview: {
          ...detail().preview!,
          companyDiagnostics: diagnostics({
            ambiguities: [
              {
                candidate,
                reason: 'multiple-companies',
                matchedCompanies: [
                  { id: 11, name: '第一会社' },
                  { id: 22, name: '第二会社' }
                ]
              }
            ]
          })
        }
      })
    )
    expect(button('通过并发布').disabled).toBe(true)
    expect(button('驳回').disabled).toBe(false)
    expect(text()).toContain('#11')
    expect(text()).toContain('#22')
    expect(text()).toContain('不是投稿人可以修改的字段')
    await click('通过并发布')
    expect(writes).toHaveLength(0)
  })

  it('shows all company diagnostic sections without treating nonblocking conflicts as approval blockers', async () => {
    await mount(
      detail({
        preview: {
          ...detail().preview!,
          companyDiagnostics: diagnostics({
            resolvedExisting: [
              {
                companyId: 33,
                name: '既有会社',
                matchedBy: 'external-id',
                candidates: [{ trust: 'verified', candidate }]
              }
            ],
            wouldCreate: [
              {
                name: '新会社',
                candidates: [{ trust: 'unverified', candidate }]
              }
            ],
            diagnostics: [
              {
                candidate,
                reason: 'external-id-name-conflict',
                matchedCompanies: [{ id: 44, name: '冲突会社' }]
              }
            ],
            snapshotDiagnostics: [
              {
                source: 'vndb',
                reason: 'lookup-id-mismatch',
                lookupId: 'v-old',
                expectedLookupId: 'v-new'
              }
            ]
          })
        }
      })
    )
    expect(button('通过并发布').disabled).toBe(false)
    for (const fragment of [
      '#33',
      '既有会社',
      '新会社',
      '#44',
      'v-old',
      'v-new'
    ])
      expect(text()).toContain(fragment)
    expect(
      dom.window.document.querySelector('iframe')?.getAttribute('src')
    ).toBe('/preview/submission/1')
  })

  it.each([
    ['published', /已通过|已发布/],
    ['changes_requested', /已要求修改|待修改/],
    ['violation', /当前状态为「违规处理」|已违规处理|已判违规/]
  ] as const)(
    'renders the real %s status and locks further review actions',
    async (status, label) => {
      await mount(detail({ status }))
      expect(text()).toMatch(label)
      for (const action of ['通过并发布', '要求修改', '驳回', '违规处理'])
        expect(button(action).disabled).toBe(true)
    }
  )

  it('explicitly tells the reviewer when a duplicate VNDB submission was not confirmed by its author', async () => {
    await mount(
      detail({
        vndbDuplicates: [
          { uniqueId: 'existing', name: '同一 VNDB ID 的既有条目' }
        ],
        duplicateConfirmed: false
      })
    )
    expect(text()).toContain('同一 VNDB ID 的既有条目')
    expect(text()).toMatch(/投稿[人者][^。\n]*未[^。\n]*确认/)
    expect(button('通过并发布').disabled).toBe(false)
  })

  it('refreshes only the captured item on a state conflict and never reports it as processed', async () => {
    await mount()
    await click('通过并发布')
    await render(item(2))
    await act(async () => {
      loads[1].resolve(detail({ id: 2, name: '另一条投稿' }))
    })
    await settle(PATCH_SUBMISSION_REVIEW_STATE_CHANGED_MESSAGE)
    expect(mocks.onStateChanged).toHaveBeenCalledExactlyOnceWith('submission:1')
    expect(mocks.onProcessed).not.toHaveBeenCalled()
    expect(text()).toContain('另一条投稿')
    expect(text()).not.toContain(PATCH_SUBMISSION_REVIEW_STATE_CHANGED_MESSAGE)
  })

  it('makes only one approval write for clicks before React rerenders', async () => {
    await mount()
    const approve = button('通过并发布')
    await act(async () => {
      approve.click()
      approve.click()
    })
    expect(writes).toHaveLength(1)
    expect(button('通过并发布').disabled).toBe(true)
    await settle({})
    expect(mocks.onProcessed).toHaveBeenCalledOnce()
  })

  it('keeps unrelated business errors visible and permits a retry with the same review reason', async () => {
    await mount()
    await fillReason('审核说明')
    await click('驳回')
    await settle('服务器拒绝此次操作')
    expect(text()).toContain('服务器拒绝此次操作')
    expect(dom.window.document.querySelector('textarea')?.value).toBe(
      '审核说明'
    )
    expect(button('驳回').disabled).toBe(false)
    expect(mocks.onProcessed).not.toHaveBeenCalled()
    expect(mocks.onStateChanged).not.toHaveBeenCalled()
    await click('驳回')
    expect(writes).toHaveLength(2)
    expect(writes[1].body.reason).toBe('审核说明')
  })

  it('does not let an old detail response replace the newly selected submission', async () => {
    await render(item(1))
    await render(item(2))
    await act(async () => {
      loads[1].resolve(detail({ id: 2, name: '当前投稿' }))
    })
    await act(async () => {
      loads[0].resolve(detail({ id: 1, name: '旧投稿' }))
    })
    expect(text()).toContain('当前投稿')
    expect(text()).not.toContain('旧投稿')
    await click('通过并发布')
    expect(writes[0].body.submissionId).toBe(2)
  })

  it('reloads the same ID when its submitted version changes and ignores the older detail request', async () => {
    await render(item(1))
    await render(item(1, '2026-09-02T00:00:00.000Z'))
    expect(loads).toHaveLength(2)
    await act(async () => {
      loads[1].resolve(detail({ name: '重提后的版本' }))
    })
    await act(async () => {
      loads[0].resolve(detail({ name: '先前版本' }))
    })
    expect(text()).toContain('重提后的版本')
    expect(text()).not.toContain('先前版本')
  })

  it('does not display an older review failure under a newly submitted version of the same ID', async () => {
    await mount()
    await fillReason('旧版本审核意见')
    await click('要求修改')
    await render(item(1, '2026-09-02T00:00:00.000Z'))
    await act(async () => {
      loads[1].resolve(detail({ name: '同一投稿的新版本' }))
    })
    await settle('旧版本的审核错误')
    expect(text()).toContain('同一投稿的新版本')
    expect(text()).not.toContain('旧版本的审核错误')
    expect(mocks.onProcessed).not.toHaveBeenCalled()
    expect(mocks.onStateChanged).not.toHaveBeenCalled()
  })

  it.each(['success', 'business-error', 'network-error'] as const)(
    'isolates an old %s review completion from the new selection',
    async (outcome) => {
      await mount()
      await fillReason('A审核说明')
      await click('驳回')
      await render(item(2))
      await act(async () => {
        loads[1].resolve(detail({ id: 2, name: 'B投稿' }))
      })
      if (outcome === 'network-error') {
        await act(async () => {
          writes[0].reject(new Error('网络失败'))
        })
      } else {
        await settle(outcome === 'success' ? {} : 'A操作失败')
      }
      expect(text()).toContain('B投稿')
      expect(text()).not.toContain('A操作失败')
      expect(text()).not.toContain('网络错误，操作未完成')
      expect(dom.window.document.querySelector('textarea')?.value).toBe('')
      expect(mocks.onStateChanged).not.toHaveBeenCalled()
      if (outcome === 'success')
        expect(mocks.onProcessed).toHaveBeenCalledExactlyOnceWith(
          'submission:1'
        )
      else expect(mocks.onProcessed).not.toHaveBeenCalled()
    }
  )
})
