import React, { act } from 'react'
import type { Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useForm, type Control } from 'react-hook-form'

const mocks = vi.hoisted(() => ({
  user: { uid: 100, name: 'Tester', role: 1 }
}))

vi.mock('~/store/userStore', () => ({
  useUserStore: (
    selector: (state: { user: typeof mocks.user }) => unknown
  ) => selector({ user: mocks.user })
}))

vi.mock('@heroui/input', () => ({
  Input: (props: Record<string, unknown>) => <input {...props} />
}))
vi.mock('@heroui/button', () => ({
  Button: ({
    children,
    onPress,
    isDisabled,
    startContent
  }: {
    children?: React.ReactNode
    onPress?: () => void
    isDisabled?: boolean
    startContent?: React.ReactNode
  }) => (
    <button type="button" disabled={isDisabled} onClick={onPress}>
      {startContent}
      {children}
    </button>
  )
}))
vi.mock('@heroui/card', () => ({
  Card: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  CardBody: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  )
}))
vi.mock('@heroui/chip', () => ({
  Chip: ({ children }: { children?: React.ReactNode }) => (
    <span>{children}</span>
  )
}))
vi.mock('@heroui/divider', () => ({ Divider: () => <hr /> }))
vi.mock('@heroui/select', () => ({
  Select: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectItem: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  )
}))
vi.mock('~/components/patch/resource/upload/FileUploadContainer', () => ({
  FileUploadContainer: () => <div data-testid="file-upload" />
}))

import { ResourceLinksInput } from '~/components/patch/resource/publish/ResourceLinksInput'
import type { PatchResourceLink } from '~/types/api/patch'

globalThis.React = React

type LinkFormValue = Partial<PatchResourceLink> & {
  storage: string
  content: string
  size: string
  hash: string
  code: string
  password: string
}

interface HarnessValue {
  section: string
  links: LinkFormValue[]
}

const Harness = ({
  initialLinks,
  onControl
}: {
  initialLinks: LinkFormValue[]
  onControl: (control: Control<HarnessValue>) => void
}) => {
  const { control, setValue, watch, formState } = useForm<HarnessValue>({
    defaultValues: { section: 'galgame', links: initialLinks }
  })
  onControl(control)
  return (
    <ResourceLinksInput
      control={control as never}
      errors={formState.errors as never}
      setValue={setValue as never}
      watch={watch as never}
      section="galgame"
      setUploadingResource={() => {}}
    />
  )
}

describe('ResourceLinksInput field array keeps domain link IDs', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

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

  const formLinks = (control: Control<HarnessValue>) =>
    (control._formValues as HarnessValue).links

  it('preserves existing domain IDs and never lets generated keys overwrite them', async () => {
    let captured: Control<HarnessValue> | null = null
    const container = await mount(
      <Harness
        initialLinks={[
          {
            id: 21,
            storage: 'user',
            content: 'https://pan.example.com/share',
            size: '2 GB',
            hash: '',
            code: '',
            password: ''
          }
        ]}
        onControl={(control) => {
          captured = control
        }}
      />
    )

    const first = formLinks(captured!)[0]
    expect(first.id).toBe(21)
    // 行键与领域 id 分属不同命名空间，值里不混入生成的行键
    expect('__fieldKey' in first).toBe(false)
    expect(container.textContent).toContain('链接 #1')
  })

  it('appends new slots without a domain id and keeps existing IDs on reorder/remove', async () => {
    let captured: Control<HarnessValue> | null = null
    const container = await mount(
      <Harness
        initialLinks={[
          {
            id: 21,
            storage: 'user',
            content: 'https://a.example.com/1',
            size: '2 GB',
            hash: '',
            code: '',
            password: ''
          },
          {
            id: 22,
            storage: 'user',
            content: 'https://a.example.com/2',
            size: '1 GB',
            hash: '',
            code: '',
            password: ''
          }
        ]}
        onControl={(control) => {
          captured = control
        }}
      />
    )

    // 追加新槽位：无领域 id
    await act(async () => {
      ;[...container.querySelectorAll('button')]
        .find((button) => button.textContent?.includes('添加链接'))!
        .click()
    })
    let links = formLinks(captured!)
    expect(links.length).toBe(3)
    expect(links[2].id).toBeUndefined()
    expect(links.map((link) => link.id)).toEqual([21, 22, undefined])

    // 删除第一条：原有 id 集合随之收缩，绝不错配
    await act(async () => {
      ;[...container.querySelectorAll('button')].find(
        (button) => button.textContent?.trim() === ''
      )!.click()
    })
    links = formLinks(captured!)
    expect(links.map((link) => link.id)).toEqual([22, undefined])
  })
})
