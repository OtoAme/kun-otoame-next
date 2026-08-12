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
    classNames,
    isRequired,
    isInvalid,
    showScrollIndicators,
    maxListboxHeight,
    popoverProps,
    listboxProps,
    selectedKeys,
    selectionMode,
    isDisabled
  }: {
    children?: React.ReactNode
    label?: string
    classNames?: { label?: string; value?: string }
    isRequired?: boolean
    isInvalid?: boolean
    showScrollIndicators?: boolean
    maxListboxHeight?: number
    popoverProps?: { placement?: string; shouldFlip?: boolean }
    listboxProps?: { hideSelectedIcon?: boolean }
    selectedKeys?: Iterable<React.Key>
    selectionMode?: 'single' | 'multiple'
    isDisabled?: boolean
  }) => (
    <label>
      {label && (
        <span className={classNames?.label} data-required={isRequired}>
          {label}
        </span>
      )}
      <div
        aria-label={label}
        className={classNames?.value}
        data-max-listbox-height={maxListboxHeight}
        data-hide-selected-icon={listboxProps?.hideSelectedIcon}
        data-invalid={isInvalid}
        data-placement={popoverProps?.placement}
        data-selected-keys={Array.from(selectedKeys ?? []).join(',')}
        data-selection-mode={selectionMode}
        data-show-scroll-indicators={showScrollIndicators}
        data-should-flip={popoverProps?.shouldFlip}
        data-disabled={isDisabled}
      >
        {children}
      </div>
    </label>
  ),
  SelectItem: ({
    children,
    textValue
  }: {
    children?: React.ReactNode
    textValue?: string
  }) => (
    <div data-testid="resource-type-option">
      <span data-text-value={textValue}>{children}</span>
    </div>
  ),
  SelectSection: ({
    children,
    title,
    classNames
  }: {
    children?: React.ReactNode
    title?: string
    classNames?: { heading?: string }
  }) => (
    <section
      data-testid="resource-type-section"
      data-title={title}
      data-heading-class={classNames?.heading}
    >
      <span className={classNames?.heading}>{title}</span>
      <div>{children}</div>
    </section>
  )
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

const renderResourceDetailsForm = async (
  section: 'patch' | 'galgame' = 'patch',
  initialTypes: string[] = section === 'galgame' ? ['pc'] : ['patch']
) => {
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
      setValue,
      formState: { errors }
    } = useForm<FormData>({
      defaultValues: {
        patchId: 1,
        section,
        name: '测试资源',
        type: initialTypes,
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
        setValue={setValue}
        errors={errors}
        section={section}
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

  it('splits Chinese support into its own grouped multi-select', async () => {
    const rendered = await renderResourceDetailsForm('galgame')
    root = rendered.root
    dom = rendered.dom

    expect(
      dom.window.document.querySelector('[data-testid="resource-type-hint"]')
    ).toBeNull()

    const typeSelect = dom.window.document.querySelector('[aria-label="类型"]')
    const chineseSupportSelect = dom.window.document.querySelector(
      '[aria-label="中文支持"]'
    )
    expect(typeSelect?.getAttribute('data-selected-keys')).toBe('pc')
    expect(chineseSupportSelect?.getAttribute('data-selected-keys')).toBe('')
    expect(chineseSupportSelect?.getAttribute('data-selection-mode')).toBe(
      'multiple'
    )
    expect(chineseSupportSelect?.getAttribute('data-disabled')).toBe('false')
    expect(
      chineseSupportSelect?.parentElement?.querySelector('span')?.textContent
    ).toBe('中文支持')
    expect(
      chineseSupportSelect?.parentElement
        ?.querySelector('span')
        ?.getAttribute('data-required')
    ).toBe('true')
    expect(chineseSupportSelect?.getAttribute('data-max-listbox-height')).toBe(
      '256'
    )
    expect(chineseSupportSelect?.getAttribute('data-placement')).toBe('top')
    expect(chineseSupportSelect?.getAttribute('data-should-flip')).toBe('false')

    const sections = Array.from(
      dom.window.document.querySelectorAll(
        '[data-testid="resource-type-section"]'
      )
    )
    expect(
      sections.map((section) => section.getAttribute('data-title'))
    ).toEqual(['游戏类型', '其他类型'])
    expect(
      sections.map((section) => section.getAttribute('data-heading-class'))
    ).toEqual([null, null])
    for (const section of sections) {
      const headingClass = section.getAttribute('data-heading-class')
      expect(headingClass).toBeNull()
    }
    expect(typeSelect?.getAttribute('data-show-scroll-indicators')).toBe(
      'false'
    )
    expect(typeSelect?.getAttribute('data-max-listbox-height')).toBe('360')
    expect(typeSelect?.getAttribute('data-hide-selected-icon')).toBeNull()
    expect(typeSelect?.getAttribute('data-placement')).toBe('top')
    expect(typeSelect?.getAttribute('data-should-flip')).toBe('false')
    expect(
      dom.window.document.querySelectorAll(
        '[data-testid="resource-type-option"] .text'
      )
    ).toHaveLength(9)
    expect(
      dom.window.document.querySelectorAll(
        '[data-testid="resource-type-option"] .text-small.text-default-500'
      )
    ).toHaveLength(9)
    expect(
      dom.window.document.querySelectorAll(
        '[data-testid="resource-type-divider"]'
      )
    ).toHaveLength(0)
  })

  it.each(['material', 'tool'] as const)(
    'disables and clears Chinese support for %s resources',
    async (resourceType) => {
      const rendered = await renderResourceDetailsForm('galgame', [
        resourceType,
        'official-zh'
      ])
      root = rendered.root
      dom = rendered.dom

      const typeSelect =
        dom.window.document.querySelector('[aria-label="类型"]')
      const chineseSupportSelect = dom.window.document.querySelector(
        '[aria-label="中文支持"]'
      )

      expect(typeSelect?.getAttribute('data-selected-keys')).toBe(resourceType)
      expect(chineseSupportSelect?.getAttribute('data-selected-keys')).toBe('')
      expect(chineseSupportSelect?.getAttribute('data-disabled')).toBe('true')
      expect(
        chineseSupportSelect?.parentElement
          ?.querySelector('span')
          ?.getAttribute('data-required')
      ).toBe('false')
    }
  )

  it('uses a compact patch type dropdown and shows the translation patch hint', async () => {
    const rendered = await renderResourceDetailsForm()
    root = rendered.root
    dom = rendered.dom

    const typeSelect = dom.window.document.querySelector('[aria-label="类型"]')
    const languageSelect =
      dom.window.document.querySelector('[aria-label="语言"]')
    const hint = dom.window.document.querySelector(
      '[data-testid="resource-type-hint"]'
    )

    expect(typeSelect?.getAttribute('data-max-listbox-height')).toBe('300')
    expect(typeSelect?.getAttribute('data-placement')).toBe('top')
    expect(typeSelect?.getAttribute('data-should-flip')).toBe('false')
    expect(typeSelect?.getAttribute('data-show-scroll-indicators')).toBe(
      'false'
    )
    expect(hint?.textContent).toBe(
      '翻译补丁包括：民汉补丁、AI 翻译补丁、机翻补丁'
    )
    expect(hint?.className).toContain('text-small')
    expect(hint?.className).toContain('text-foreground-500')
    expect(
      hint?.previousElementSibling?.querySelector('[aria-label="类型"]')
    ).not.toBeNull()
    expect(
      hint?.nextElementSibling?.querySelector('[aria-label="语言"]')
    ).not.toBeNull()
    expect(
      dom.window.document.querySelectorAll(
        '[data-testid="resource-type-section"]'
      )
    ).toHaveLength(0)
  })
})
