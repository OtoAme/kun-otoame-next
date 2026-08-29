import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import type { PatchSubmission } from '~/types/api/patchSubmission'

globalThis.React = React

const fetchMocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  formData: vi.fn()
}))

vi.mock('~/utils/kunFetch', () => ({
  kunFetchGet: fetchMocks.get,
  kunFetchPost: fetchMocks.post,
  kunFetchFormData: fetchMocks.formData
}))

vi.mock('~/utils/vndb', () => ({ fetchVNDBDetails: vi.fn() }))
vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() })
}))
vi.mock('@bprogress/next', () => ({
  useRouter: () => ({ refresh: vi.fn() })
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

vi.mock('@heroui/input', () => ({
  Input: ({
    label,
    placeholder,
    value,
    isReadOnly,
    onChange
  }: {
    label?: string
    placeholder?: string
    value?: string
    isReadOnly?: boolean
    onChange?: React.ChangeEventHandler<HTMLInputElement>
  }) => (
    <input
      aria-label={label ?? placeholder}
      value={value ?? ''}
      readOnly={isReadOnly}
      onChange={onChange}
    />
  )
}))
vi.mock('@heroui/react', () => {
  const Input = ({
    label,
    placeholder,
    value,
    isReadOnly,
    isDisabled,
    onChange,
    onValueChange,
    onPaste
  }: {
    label?: string
    placeholder?: string
    value?: string
    isReadOnly?: boolean
    isDisabled?: boolean
    onChange?: React.ChangeEventHandler<HTMLInputElement>
    onValueChange?: (value: string) => void
    onPaste?: React.ClipboardEventHandler<HTMLInputElement>
  }) => (
    <input
      aria-label={label ?? placeholder}
      value={value ?? ''}
      readOnly={isReadOnly}
      disabled={isDisabled}
      onChange={(event) => {
        onChange?.(event)
        onValueChange?.(event.target.value)
      }}
      onPaste={onPaste}
    />
  )

  return {
    Avatar: () => null,
    Button: ({
      children,
      isDisabled,
      onPress,
      'aria-label': ariaLabel
    }: {
      children?: React.ReactNode
      isDisabled?: boolean
      onPress?: () => void
      'aria-label'?: string
    }) => (
      <button aria-label={ariaLabel} disabled={isDisabled} onClick={onPress}>
        {children}
      </button>
    ),
    Card: ({ children }: { children?: React.ReactNode }) => (
      <section>{children}</section>
    ),
    CardBody: ({ children }: { children?: React.ReactNode }) => (
      <div>{children}</div>
    ),
    CardHeader: ({ children }: { children?: React.ReactNode }) => (
      <header>{children}</header>
    ),
    Checkbox: ({
      children,
      isDisabled,
      isSelected,
      onValueChange
    }: {
      children?: React.ReactNode
      isDisabled?: boolean
      isSelected?: boolean
      onValueChange?: (selected: boolean) => void
    }) => (
      <label>
        <input
          type="checkbox"
          disabled={isDisabled}
          checked={isSelected}
          onChange={(event) => onValueChange?.(event.target.checked)}
        />
        {children}
      </label>
    ),
    Chip: ({
      children,
      onClose
    }: {
      children?: React.ReactNode
      onClose?: () => void
    }) => (
      <span>
        {children}
        {onClose && (
          <button aria-label="删除别名" onClick={onClose}>
            ×
          </button>
        )}
      </span>
    ),
    Image: ({ src, alt }: { src?: string; alt?: string }) => (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={alt} />
    ),
    Input,
    Switch: ({
      children,
      isDisabled,
      isSelected,
      onValueChange
    }: {
      children?: React.ReactNode
      isDisabled?: boolean
      isSelected?: boolean
      onValueChange?: (selected: boolean) => void
    }) => (
      <label>
        <input
          aria-label="文章内容分级"
          type="checkbox"
          disabled={isDisabled}
          checked={isSelected}
          onChange={(event) => onValueChange?.(event.target.checked)}
        />
        {children}
      </label>
    ),
    Textarea: ({
      placeholder,
      value,
      isReadOnly,
      onChange
    }: {
      placeholder?: string
      value?: string
      isReadOnly?: boolean
      onChange?: React.ChangeEventHandler<HTMLTextAreaElement>
    }) => (
      <textarea
        aria-label={placeholder}
        value={value ?? ''}
        readOnly={isReadOnly}
        onChange={onChange}
      />
    )
  }
})

vi.mock('~/components/edit/components/FetchPreview', () => ({
  FetchPreview: () => <div />
}))
vi.mock('~/components/kun/cropper/KunImageCropper', () => ({
  KunImageCropper: () => <button>选择封面</button>
}))
vi.mock('~/components/submission/SubmissionGalleryInput', () => ({
  SubmissionGalleryInput: () => <div>游戏截图</div>
}))
vi.mock('~/components/submission/SubmissionIntroduction', () => ({
  SubmissionIntroduction: ({ editable }: { editable: boolean }) => (
    <textarea aria-label="游戏介绍" readOnly={!editable} />
  )
}))
vi.mock('~/components/submission/SubmissionPreview', () => ({
  SubmissionPreview: () => <button>预览</button>
}))
vi.mock('~/hooks/usePatchSubmissionAutosave', () => ({
  usePatchSubmissionAutosave: () => ({
    queueSave: vi.fn(),
    flush: vi.fn().mockResolvedValue({ ok: true })
  })
}))

import { SubmissionEditor } from '~/components/submission/SubmissionEditor'
import { usePatchSubmissionStore } from '~/store/patchSubmissionStore'

const rejectedSubmission: PatchSubmission = {
  id: 41,
  status: 'rejected',
  payload: {
    name: 'Rejected game',
    introduction: 'Rejected introduction',
    vndbId: 'v41',
    vndbRelationId: 'r41',
    bangumiId: '41',
    steamId: '410',
    dlsiteCode: '',
    dlsiteCircleName: '',
    dlsiteCircleLink: '',
    vndbTags: [],
    vndbDevelopers: [],
    bangumiTags: ['乙女'],
    bangumiDevelopers: [],
    steamTags: [],
    steamDevelopers: [],
    steamAliases: [],
    officialUrl: 'https://example.test',
    alias: ['Rejected alias'],
    tag: ['Manual tag'],
    released: '2026-08-28',
    contentLimit: 'sfw',
    isDuplicate: false
  },
  payloadVersion: 1,
  revision: 2,
  heldAmount: 10,
  roleAtCreation: 1,
  reviewReason: '不在收录范围内',
  reviewedAt: '2026-08-28T00:00:00.000Z',
  patchUniqueId: null,
  bannerUrl: null,
  externalSource: 'vndb',
  externalFetchedAt: '2026-08-27T00:00:00.000Z',
  gallery: [],
  submittedAt: '2026-08-27T00:00:00.000Z',
  created: '2026-08-27T00:00:00.000Z',
  updated: '2026-08-28T00:00:00.000Z'
}

describe('rejected patch submission controls', () => {
  let dom: JSDOM
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    usePatchSubmissionStore.getState().reset()
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost/submission/41'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    root = createRoot(dom.window.document.getElementById('root')!)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    vi.unstubAllGlobals()
  })

  it('keeps the form visible while disabling every editing and fetch control', async () => {
    await act(async () => {
      root.render(<SubmissionEditor submission={rejectedSubmission} />)
      await Promise.resolve()
    })

    const buttons = [...dom.window.document.querySelectorAll('button')]
    for (const label of [
      '获取 VNDB 数据',
      '获取 Release 数据',
      '获取 Bangumi 数据',
      '获取 Steam 数据'
    ]) {
      const button = buttons.find((item) => item.textContent === label)
      expect(button, `${label} should remain visible`).toBeDefined()
      expect(button?.disabled, `${label} should be disabled`).toBe(true)
    }

    for (const label of [
      '游戏名称',
      '请输入 VNDB ID, 例如 v19658',
      '请输入 Release ID, 例如 r5879',
      '请输入 Bangumi 条目 ID, 例如 172612',
      '请输入 Steam App ID, 例如 3655150',
      '输入 Steam 商店链接或官方网站链接',
      '发售日期',
      '输入后点击加号添加'
    ]) {
      const input = dom.window.document.querySelector<HTMLInputElement>(
        `input[aria-label="${label}"]`
      )
      expect(input, `${label} should remain visible`).not.toBeNull()
      expect(input?.readOnly, `${label} should be read-only`).toBe(true)
    }

    const tags = dom.window.document.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label^="批量添加标签"]'
    )
    expect(tags?.readOnly).toBe(true)
    expect(
      dom.window.document.querySelector<HTMLInputElement>(
        'input[aria-label="文章内容分级"]'
      )?.disabled
    ).toBe(true)
    expect(
      dom.window.document.querySelector<HTMLButtonElement>(
        'button[aria-label="添加 OtomeGame 别名"]'
      )?.disabled
    ).toBe(true)
    expect(
      dom.window.document.querySelector('button[aria-label="删除别名"]')
    ).toBeNull()
    expect(dom.window.document.body.textContent).toContain('Rejected alias')
    expect(dom.window.document.body.textContent).toContain('暂无可显示的封面')
    expect(buttons.some((button) => button.textContent === '选择封面')).toBe(
      false
    )
    expect(buttons.some((button) => button.textContent === '保存草稿')).toBe(
      false
    )
    expect(buttons.some((button) => button.textContent === '提交审核')).toBe(
      false
    )

    buttons.find((button) => button.textContent === '获取 VNDB 数据')?.click()
    expect(fetchMocks.get).not.toHaveBeenCalled()
    expect(fetchMocks.post).not.toHaveBeenCalled()
  })
})

const draftSubmission: PatchSubmission = {
  ...rejectedSubmission,
  id: 42,
  status: 'draft',
  reviewReason: null,
  reviewedAt: null
}

describe('draft submission order gate', () => {
  let dom: JSDOM
  let root: Root

  const submitButton = () =>
    [...dom.window.document.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === '提交审核'
    )

  beforeEach(() => {
    vi.clearAllMocks()
    usePatchSubmissionStore.getState().reset()
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost/submission/42'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    root = createRoot(dom.window.document.getElementById('root')!)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    vi.unstubAllGlobals()
  })

  it('blocks submission while a dragged screenshot order is unsaved', async () => {
    await act(async () => {
      root.render(<SubmissionEditor submission={draftSubmission} />)
      await Promise.resolve()
    })
    await act(async () => {
      usePatchSubmissionStore.setState({ assetDraftLoaded: true })
      await Promise.resolve()
    })
    expect(submitButton()?.disabled).toBe(false)

    await act(async () => {
      usePatchSubmissionStore.setState({ assetOrderDirty: true })
      await Promise.resolve()
    })

    expect(submitButton()?.disabled).toBe(true)
    expect(dom.window.document.body.textContent).toContain(
      '截图顺序尚未保存, 请在截图区点击「保存排序」后再提交。'
    )
  })
})
