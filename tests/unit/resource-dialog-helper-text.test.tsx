import React, { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import type { PatchResource } from '~/types/api/patch'

globalThis.React = React

vi.mock('@hookform/resolvers/zod', () => ({
  zodResolver: () => undefined
}))

vi.mock('@heroui/button', () => ({
  Button: ({
    children,
    onPress,
    disabled,
    isLoading
  }: {
    children?: React.ReactNode
    onPress?: () => void
    disabled?: boolean
    isLoading?: boolean
  }) => (
    <button type="button" disabled={disabled || isLoading} onClick={onPress}>
      {children}
    </button>
  )
}))

vi.mock('@heroui/link', () => ({
  Link: ({ children, href }: { children?: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  )
}))

vi.mock('@heroui/react', () => ({
  ModalBody: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ModalContent: ({ children }: { children?: React.ReactNode }) => (
    <section>{children}</section>
  ),
  ModalFooter: ({ children }: { children?: React.ReactNode }) => (
    <footer>{children}</footer>
  ),
  ModalHeader: ({
    children,
    className
  }: {
    children?: React.ReactNode
    className?: string
  }) => <header className={className}>{children}</header>,
  Progress: ({ value }: { value?: number }) => (
    <progress value={value} max={100} />
  ),
  Radio: ({
    children,
    value
  }: {
    children?: React.ReactNode
    value: string
  }) => <label data-value={value}>{children}</label>,
  RadioGroup: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  )
}))

vi.mock('~/components/patch/resource/publish/ResourceLinksInput', () => ({
  createEmptyResourceLink: () => ({
    storage: 's3',
    hash: '',
    content: '',
    size: '',
    code: '',
    password: ''
  }),
  ResourceLinksInput: () => <div data-testid="resource-links-input" />
}))

vi.mock('~/components/patch/resource/publish/ResourceDetailsForm', () => ({
  ResourceDetailsForm: () => <div data-testid="resource-details-form" />
}))

vi.mock('react-hot-toast', () => ({
  default: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn()
  })
}))

vi.mock('~/store/userStore', () => ({
  useUserStore: (
    selector: (state: {
      user: { role: number; dailyUploadLimit: number }
    }) => unknown
  ) => selector({ user: { role: 3, dailyUploadLimit: 1024 } })
}))

const resource: PatchResource = {
  id: 10,
  name: '测试资源',
  section: 'patch',
  uniqueId: 'abc12345',
  type: ['patch'],
  language: ['zh-Hans'],
  platform: ['windows'],
  note: '',
  links: [
    {
      id: 20,
      storage: 's3',
      size: '2 GB',
      code: '',
      password: '',
      hash: 'file-hash',
      content: '',
      sortOrder: 0,
      download: 0
    }
  ],
  likeCount: 0,
  download: 0,
  isLike: false,
  status: 0,
  userId: 3,
  patchId: 30,
  created: '2026-06-29T00:00:00.000Z',
  user: {
    id: 3,
    name: '资源作者',
    avatar: '',
    patchCount: 1,
    role: 3
  }
}

const renderComponent = async (component: React.ReactElement) => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: 'http://localhost'
  })

  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

  const container = dom.window.document.getElementById('root')
  expect(container).not.toBeNull()

  const root = createRoot(container!)
  await act(async () => {
    root.render(component)
  })

  return { dom, root }
}

describe('resource dialog helper text', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    root = undefined
    dom?.window.close()
    dom = undefined
    vi.unstubAllGlobals()
  })

  it('prevents selecting helper text in the create resource dialog', async () => {
    const { PublishResource } = await import(
      '~/components/patch/resource/publish/PublishResource'
    )
    const rendered = await renderComponent(
      <PublishResource patchId={1} onClose={vi.fn()} />
    )
    root = rendered.root
    dom = rendered.dom

    const helper = Array.from(
      dom.window.document.querySelectorAll('header > div')
    ).find((element) => element.textContent?.includes('每日上传总额度'))

    expect(helper?.className).toContain('select-none')
  })

  it('prevents selecting helper text in the edit resource dialog', async () => {
    const { EditResourceDialog } = await import(
      '~/components/patch/resource/edit/EditResourceDialog'
    )
    const rendered = await renderComponent(
      <EditResourceDialog
        resource={resource}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    )
    root = rendered.root
    dom = rendered.dom

    const helper = Array.from(dom.window.document.querySelectorAll('p')).find(
      (element) => element.textContent?.includes('若您想要更改您的对象存储链接')
    )

    expect(helper?.className).toContain('select-none')
  })
})
