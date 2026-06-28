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
    onChange
  }: {
    label: string
    value?: string
    classNames?: { label?: string; input?: string }
    onChange?: React.ChangeEventHandler<HTMLInputElement>
  }) => (
    <label>
      <span className={classNames?.label}>{label}</span>
      <input
        aria-label={label}
        className={classNames?.input}
        value={value ?? ''}
        onChange={onChange}
      />
    </label>
  ),
  Textarea: ({
    label,
    value,
    classNames,
    onChange
  }: {
    label: string
    value?: string
    classNames?: { label?: string; input?: string }
    onChange?: React.ChangeEventHandler<HTMLTextAreaElement>
  }) => (
    <label>
      <span className={classNames?.label}>{label}</span>
      <textarea
        aria-label={label}
        className={classNames?.input}
        value={value ?? ''}
        onChange={onChange}
      />
    </label>
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

type FormData = {
  patchId: number
  section: 'patch' | 'galgame'
  name: string
  type: string[]
  language: string[]
  platform: string[]
  note: string
  links: {
    storage: string
    hash: string
    content: string
    size: string
    code: string
    password: string
  }[]
}

const renderResourceDetailsForm = async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: 'http://localhost'
  })

  vi.stubGlobal('window', dom.window)
  vi.stubGlobal('document', dom.window.document)
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

  const { ResourceDetailsForm } = await import(
    '~/components/patch/resource/publish/ResourceDetailsForm'
  )

  const TestForm = () => {
    const {
      control,
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
            storage: 'user',
            hash: '',
            content: 'https://example.com/file.zip',
            size: '2 GB',
            code: '',
            password: ''
          }
        ]
      }
    })

    return (
      <ResourceDetailsForm
        control={control}
        setValue={vi.fn()}
        errors={errors}
        section="patch"
      />
    )
  }

  const container = dom.window.document.getElementById('root')
  expect(container).not.toBeNull()

  const root = createRoot(container!)
  await act(async () => {
    root.render(<TestForm />)
  })

  return { dom, root }
}

describe('resource details form', () => {
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

  it('prevents selecting resource detail field labels without disabling input text selection', async () => {
    const rendered = await renderResourceDetailsForm()
    root = rendered.root
    dom = rendered.dom

    for (const label of ['类型', '语言', '平台', '资源名称', '备注']) {
      const labelElement = Array.from(
        dom.window.document.querySelectorAll('span')
      ).find((element) => element.textContent === label)

      expect(labelElement?.className).toContain('select-none')
    }

    const resourceNameInput = dom.window.document.querySelector(
      'input[aria-label="资源名称"]'
    )
    const noteTextarea = dom.window.document.querySelector(
      'textarea[aria-label="备注"]'
    )

    expect(resourceNameInput?.className).not.toContain('select-none')
    expect(noteTextarea?.className).not.toContain('select-none')
  })
})
