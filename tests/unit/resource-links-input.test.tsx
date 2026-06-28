import React, { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import { useForm } from 'react-hook-form'

globalThis.React = React

vi.mock('@heroui/input', () => ({
  Input: ({
    label,
    value,
    classNames,
    isDisabled,
    disabled,
    isReadOnly,
    onChange,
    onBlur
  }: {
    label: string
    value?: string
    classNames?: { label?: string; input?: string }
    isDisabled?: boolean
    disabled?: boolean
    isReadOnly?: boolean
    onChange?: React.ChangeEventHandler<HTMLInputElement>
    onBlur?: React.FocusEventHandler<HTMLInputElement>
  }) => (
    <label>
      <span className={classNames?.label}>{label}</span>
      <input
        aria-label={label}
        className={classNames?.input}
        value={value ?? ''}
        disabled={isDisabled || disabled}
        readOnly={isReadOnly}
        onChange={onChange}
        onBlur={onBlur}
      />
    </label>
  )
}))

vi.mock('@heroui/button', () => ({
  Button: ({
    children,
    onPress,
    isDisabled,
    disabled
  }: {
    children?: React.ReactNode
    onPress?: () => void
    isDisabled?: boolean
    disabled?: boolean
  }) => (
    <button type="button" disabled={isDisabled || disabled} onClick={onPress}>
      {children}
    </button>
  )
}))

vi.mock('@heroui/card', () => ({
  Card: ({ children }: { children?: React.ReactNode }) => (
    <section>{children}</section>
  ),
  CardBody: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  )
}))

vi.mock('@heroui/chip', () => ({
  Chip: ({ children }: { children?: React.ReactNode }) => (
    <span>{children}</span>
  )
}))

vi.mock('@heroui/select', () => ({
  Select: ({
    children,
    label,
    classNames
  }: {
    children?: React.ReactNode
    label?: string
    classNames?: { label?: string; value?: string }
  }) => (
    <label>
      {label && <span className={classNames?.label}>{label}</span>}
      <select aria-label={label} className={classNames?.value}>
        {children}
      </select>
    </label>
  ),
  SelectItem: ({
    children,
    textValue
  }: {
    children?: React.ReactNode
    textValue?: string
  }) => <option>{textValue ?? children}</option>
}))

vi.mock('@heroui/divider', () => ({
  Divider: () => <hr />
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
  ) => selector({ user: { role: 3, dailyUploadLimit: 0 } })
}))

vi.mock('~/components/patch/resource/upload/FileUploadContainer', () => ({
  FileUploadContainer: () => <div data-testid="upload-container" />
}))

type FormData = {
  patchId: number
  section: 'patch' | 'galgame'
  name: string
  type: string[]
  language: string[]
  platform: string[]
  note: string
  links: {
    id?: number
    storage: string
    uploadId?: string
    hash: string
    content: string
    size: string
    code: string
    password: string
  }[]
}

const renderResourceLinksInput = async (storage: string) => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: 'http://localhost'
  })

  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

  const { ResourceLinksInput } = await import(
    '~/components/patch/resource/publish/ResourceLinksInput'
  )

  const TestForm = () => {
    const {
      control,
      setValue,
      watch,
      formState: { errors }
    } = useForm<FormData>({
      defaultValues: {
        patchId: 1,
        section: 'patch',
        name: '测试资源',
        type: ['patch'],
        language: ['zh-Hans'],
        platform: ['windows'],
        note: '',
        links: [
          {
            id: 10,
            storage,
            hash: storage === 's3' ? 'file-hash' : '',
            content: storage === 's3' ? '' : 'https://example.com/file.zip',
            size: '2 GB',
            code: '',
            password: ''
          }
        ]
      }
    })

    return (
      <ResourceLinksInput
        control={control}
        errors={errors}
        setValue={setValue}
        watch={watch}
        section="patch"
        setUploadingResource={vi.fn()}
      />
    )
  }

  const container = dom.window.document.getElementById('root')
  expect(container).not.toBeNull()

  const root = createRoot(container!)
  await act(async () => {
    root.render(<TestForm />)
  })

  const sizeInput = container!.querySelector(
    'input[aria-label="大小 (MB 或 GB)"]'
  ) as HTMLInputElement | null
  expect(sizeInput).not.toBeNull()

  return { dom, root, sizeInput: sizeInput! }
}

describe('resource links input', () => {
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

  it('disables the size input for object storage links', async () => {
    const rendered = await renderResourceLinksInput('s3')
    root = rendered.root
    dom = rendered.dom

    expect(rendered.sizeInput.disabled).toBe(true)
  })

  it('keeps the size input editable for regular user links', async () => {
    const rendered = await renderResourceLinksInput('user')
    root = rendered.root
    dom = rendered.dom

    expect(rendered.sizeInput.disabled).toBe(false)
  })

  it('prevents selecting resource link helper text', async () => {
    const rendered = await renderResourceLinksInput('user')
    root = rendered.root
    dom = rendered.dom

    const helperText = Array.from(
      dom!.window.document.querySelectorAll('p')
    ).find((element) =>
      element.textContent?.includes('每条资源链接都拥有独立的存储类型')
    )

    expect(helperText?.className).toContain('select-none')
  })

  it('prevents selecting resource link field labels without disabling input text selection', async () => {
    const rendered = await renderResourceLinksInput('user')
    root = rendered.root
    dom = rendered.dom

    for (const label of [
      '存储类型',
      '资源链接',
      '大小 (MB 或 GB)',
      '提取码',
      '解压码'
    ]) {
      const labelElement = Array.from(
        dom!.window.document.querySelectorAll('span')
      ).find((element) => element.textContent === label)

      expect(labelElement?.className).toContain('select-none')
    }

    const resourceLinkInput = dom!.window.document.querySelector(
      'input[aria-label="资源链接"]'
    )

    expect(resourceLinkInput?.className).not.toContain('select-none')
  })
})
