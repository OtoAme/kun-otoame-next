import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import type { AdminStickerPack } from '~/types/api/admin'

globalThis.React = React

const fetchMock = vi.hoisted(() => ({
  kunFetchDelete: vi.fn(),
  kunFetchDeleteBody: vi.fn(),
  kunFetchFormData: vi.fn(),
  kunFetchPost: vi.fn(),
  kunFetchPut: vi.fn()
}))

const toastMock = vi.hoisted(() => vi.fn())

vi.mock('~/utils/kunFetch', () => fetchMock)

vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn(),
    success: vi.fn()
  }
}))

vi.mock('@heroui/react', () => {
  const Button = ({
    children,
    isDisabled,
    isLoading,
    onPress,
    type = 'button',
    ...props
  }: {
    children?: React.ReactNode
    isDisabled?: boolean
    isLoading?: boolean
    onPress?: () => void
    type?: 'button' | 'submit' | 'reset'
    [key: string]: unknown
  }) => (
    <button
      {...props}
      type={type}
      disabled={isDisabled || isLoading}
      onClick={onPress}
    >
      {children}
    </button>
  )

  const Input = React.forwardRef<
    HTMLInputElement,
    {
      accept?: string
      'aria-label'?: string
      description?: string
      errorMessage?: React.ReactNode
      isInvalid?: boolean
      isReadOnly?: boolean
      isRequired?: boolean
      label?: string
      multiple?: boolean
      onChange?: React.ChangeEventHandler<HTMLInputElement>
      onValueChange?: (value: string) => void
      placeholder?: string
      type?: string
      value?: string
    }
  >(
    (
      {
        description,
        errorMessage,
        isInvalid,
        isReadOnly,
        isRequired: _isRequired,
        label,
        onChange,
        onValueChange,
        type = 'text',
        value,
        ...props
      },
      ref
    ) => (
      <label>
        <span>{label}</span>
        <input
          {...props}
          ref={ref}
          aria-label={label ?? props['aria-label']}
          readOnly={isReadOnly}
          type={type}
          {...(type === 'file' ? {} : { value: value ?? '' })}
          onInput={(event) => {
            if (type !== 'file') {
              onValueChange?.((event.target as HTMLInputElement).value)
            }
          }}
          onChange={(event) => {
            onChange?.(event)
            if (type === 'file') {
              onValueChange?.(event.target.value)
            }
          }}
        />
        {description && <span>{description}</span>}
        {isInvalid && errorMessage && <span role="alert">{errorMessage}</span>}
      </label>
    )
  )
  Input.displayName = 'Input'

  const Textarea = ({
    errorMessage,
    isInvalid,
    label,
    onValueChange,
    value
  }: {
    errorMessage?: React.ReactNode
    isInvalid?: boolean
    label?: string
    onValueChange?: (value: string) => void
    value?: string
  }) => (
    <label>
      <span>{label}</span>
      <textarea
        aria-label={label}
        value={value ?? ''}
        onChange={(event) => onValueChange?.(event.target.value)}
      />
      {isInvalid && errorMessage && <span role="alert">{errorMessage}</span>}
    </label>
  )

  const Select = ({
    children,
    id,
    items = [],
    label,
    onSelectionChange,
    selectedKeys = []
  }: {
    children?: React.ReactNode | ((item: any) => React.ReactElement)
    id?: string
    items?: any[]
    label?: string
    onSelectionChange?: (keys: Set<string>) => void
    selectedKeys?: Iterable<React.Key>
  }) => {
    const renderedItems =
      typeof children === 'function'
        ? items.map((item) => children(item))
        : React.Children.toArray(children)
    const selected = String(Array.from(selectedKeys)[0] ?? '')

    return (
      <label>
        <span>{label}</span>
        <select
          id={id}
          aria-label={label}
          value={selected}
          onChange={(event) =>
            onSelectionChange?.(new Set([event.target.value]))
          }
        >
          {renderedItems.map((item) => {
            if (!React.isValidElement(item)) {
              return null
            }
            const props = item.props as {
              children?: React.ReactNode
              textValue?: string
            }
            return (
              <option key={item.key} value={String(item.key)}>
                {props.textValue ??
                  (typeof props.children === 'string'
                    ? props.children
                    : String(item.key))}
              </option>
            )
          })}
        </select>
      </label>
    )
  }

  const ListboxItem = ({
    children,
    description,
    endContent,
    onPress,
    startContent,
    textValue
  }: {
    children?: React.ReactNode
    description?: React.ReactNode
    endContent?: React.ReactNode
    onPress?: () => void
    startContent?: React.ReactNode
    textValue?: string
  }) => (
    <button
      type="button"
      data-testid={`pack-option-${textValue}`}
      onClick={onPress}
    >
      {startContent}
      <span>{children}</span>
      <span>{description}</span>
      {endContent}
    </button>
  )

  const Listbox = ({
    children,
    items = [],
    onSelectionChange
  }: {
    children: (item: any) => React.ReactElement
    items?: any[]
    onSelectionChange?: (keys: Set<string>) => void
  }) => (
    <div role="listbox">
      {items.map((item) => {
        const element = children(item) as React.ReactElement<{
          onPress?: () => void
        }>
        return React.cloneElement(element, {
          key: item.id,
          onPress: () => onSelectionChange?.(new Set([String(item.id)]))
        })
      })}
    </div>
  )

  const Tab = ({ children }: { children?: React.ReactNode }) => <>{children}</>
  const Tabs = ({
    children,
    onSelectionChange,
    selectedKey
  }: {
    children?: React.ReactNode
    onSelectionChange?: (key: React.Key) => void
    selectedKey?: React.Key
  }) => {
    const tabs = React.Children.toArray(children).filter(React.isValidElement)
    const normalizeKey = (key: React.Key | null) =>
      String(key ?? '').replace(/^\.\$/, '')
    const active = tabs.find(
      (tab) => normalizeKey(tab.key) === String(selectedKey)
    )

    return (
      <div>
        <div role="tablist">
          {tabs.map((tab) => {
            const props = tab.props as { title?: React.ReactNode }
            const key = normalizeKey(tab.key)
            return (
              <button
                key={String(tab.key)}
                type="button"
                role="tab"
                onClick={() => onSelectionChange?.(key)}
              >
                {props.title}
              </button>
            )
          })}
        </div>
        <div role="tabpanel">
          {(active?.props as { children?: React.ReactNode } | undefined)
            ?.children ??
            (
              tabs.find((tab) => normalizeKey(tab.key) === selectedKey)
                ?.props as { children?: React.ReactNode } | undefined
            )?.children}
        </div>
      </div>
    )
  }

  return {
    addToast: toastMock,
    Avatar: ({ name }: { name?: string }) => <span>{name}</span>,
    Button,
    Card: ({
      children,
      isDisabled,
      isPressable,
      onPress,
      ...props
    }: {
      children?: React.ReactNode
      isDisabled?: boolean
      isPressable?: boolean
      onPress?: () => void
      [key: string]: unknown
    }) => (
      <div
        {...props}
        role={isPressable ? 'button' : undefined}
        aria-disabled={isDisabled}
        tabIndex={isPressable ? 0 : undefined}
        onClick={onPress}
      >
        {children}
      </div>
    ),
    CardBody: ({ children }: { children?: React.ReactNode }) => (
      <div>{children}</div>
    ),
    CardFooter: ({ children }: { children?: React.ReactNode }) => (
      <footer>{children}</footer>
    ),
    CardHeader: ({ children }: { children?: React.ReactNode }) => (
      <header>{children}</header>
    ),
    Checkbox: ({
      children,
      isDisabled,
      isSelected,
      onValueChange,
      'aria-label': ariaLabel
    }: {
      children?: React.ReactNode
      isDisabled?: boolean
      isSelected?: boolean
      onValueChange?: (selected: boolean) => void
      'aria-label'?: string
    }) => (
      <label>
        <input
          aria-label={ariaLabel}
          type="checkbox"
          checked={Boolean(isSelected)}
          disabled={isDisabled}
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
          <button type="button" aria-label="移除文件" onClick={onClose}>
            ×
          </button>
        )}
      </span>
    ),
    Divider: () => <hr />,
    Dropdown: ({ children }: { children?: React.ReactNode }) => (
      <div>{children}</div>
    ),
    DropdownItem: ({
      children,
      onPress
    }: {
      children?: React.ReactNode
      onPress?: () => void
    }) => (
      <button type="button" onClick={onPress}>
        {children}
      </button>
    ),
    DropdownMenu: ({ children }: { children?: React.ReactNode }) => (
      <div>{children}</div>
    ),
    DropdownTrigger: ({ children }: { children?: React.ReactNode }) => (
      <>{children}</>
    ),
    Image: ({ alt, src }: { alt?: string; src?: string }) => (
      <img alt={alt} src={src} />
    ),
    Input,
    Listbox,
    ListboxItem,
    Modal: ({
      children,
      isOpen
    }: {
      children?: React.ReactNode
      isOpen?: boolean
    }) => (isOpen ? <div role="dialog">{children}</div> : null),
    ModalBody: ({ children }: { children?: React.ReactNode }) => (
      <div>{children}</div>
    ),
    ModalContent: ({ children }: { children?: React.ReactNode }) => (
      <section>{children}</section>
    ),
    ModalFooter: ({ children }: { children?: React.ReactNode }) => (
      <footer>{children}</footer>
    ),
    ModalHeader: ({ children }: { children?: React.ReactNode }) => (
      <h2>{children}</h2>
    ),
    Select,
    SelectItem: ({ children }: { children?: React.ReactNode }) => (
      <>{children}</>
    ),
    ScrollShadow: ({ children }: { children?: React.ReactNode }) => (
      <div>{children}</div>
    ),
    Switch: ({
      children,
      isDisabled,
      isSelected,
      onValueChange,
      'aria-label': ariaLabel
    }: {
      children?: React.ReactNode
      isDisabled?: boolean
      isSelected?: boolean
      onValueChange?: (selected: boolean) => void
      'aria-label'?: string
    }) => (
      <button
        type="button"
        role="switch"
        aria-label={ariaLabel}
        aria-checked={isSelected}
        disabled={isDisabled}
        onClick={() => onValueChange?.(!isSelected)}
      >
        {children}
      </button>
    ),
    Tab,
    Table: ({
      children,
      topContent
    }: {
      children?: React.ReactNode
      topContent?: React.ReactNode
    }) => (
      <>
        {topContent}
        <table>{children}</table>
      </>
    ),
    TableBody: ({
      children,
      items = []
    }: {
      children: (item: any) => React.ReactNode
      items?: any[]
    }) => <tbody>{items.map((item) => children(item))}</tbody>,
    TableCell: ({ children }: { children?: React.ReactNode }) => (
      <td>{children}</td>
    ),
    TableColumn: ({ children }: { children?: React.ReactNode }) => (
      <th>{children}</th>
    ),
    TableHeader: ({ children }: { children?: React.ReactNode }) => (
      <thead>
        <tr>{children}</tr>
      </thead>
    ),
    TableRow: ({ children }: { children?: React.ReactNode }) => (
      <tr>{children}</tr>
    ),
    Tabs,
    Textarea,
    Tooltip: ({
      children,
      content
    }: {
      children?: React.ReactNode
      content?: React.ReactNode
    }) => <span data-tooltip={String(content ?? '')}>{children}</span>,
    useDisclosure: () => {
      const [isOpen, setIsOpen] = React.useState(false)
      return {
        isOpen,
        onOpen: () => setIsOpen(true),
        onClose: () => setIsOpen(false),
        onOpenChange: setIsOpen
      }
    }
  }
})

const makeSticker = (
  id: string,
  alt: string,
  status = 1
): AdminStickerPack['stickers'][number] => ({
  id,
  packId: 1,
  alt,
  assetKey: `stickers/test/${id}.webp`,
  thumbnailKey: null,
  assetUrl: `https://cdn.example.com/${id}.webp`,
  thumbnailUrl: `https://cdn.example.com/${id}.webp`,
  mime: 'image/webp',
  mediaType: 'image',
  status,
  contentHash: id,
  width: 512,
  height: 512,
  size: 1024,
  durationMs: null,
  frameRate: null,
  sortOrder: 0
})

const activePack: AdminStickerPack = {
  id: 1,
  slug: 'cute_cats',
  name: '可爱猫猫',
  description: '测试 Pack',
  status: 1,
  price: 0,
  isBuiltin: true,
  coverStickerId: 'cat_one',
  coverUrl: 'https://cdn.example.com/cat_one.webp',
  stickers: [makeSticker('cat_one', '猫猫一号')]
}

const offlinePack: AdminStickerPack = {
  ...activePack,
  id: 2,
  slug: 'sleepy_bears',
  name: '困困熊',
  status: 0,
  coverStickerId: 'bear_one',
  coverUrl: 'https://cdn.example.com/bear_one.webp',
  stickers: [
    {
      ...makeSticker('bear_one', '小熊一号'),
      packId: 2
    }
  ]
}

describe('StickerAdmin', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  const renderAdmin = async (
    initialPacks: AdminStickerPack[] = [activePack, offlinePack]
  ) => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('navigator', dom.window.navigator)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal(
      'FormData',
      class {
        append() {}
      }
    )

    const { StickerAdmin } = await import(
      '~/components/admin/stickers/Container'
    )
    const container = dom.window.document.getElementById('root')
    expect(container).not.toBeNull()

    root = createRoot(container!)
    await act(async () => {
      root!.render(<StickerAdmin initialPacks={initialPacks} />)
    })

    return container!
  }

  const clickButton = async (container: HTMLElement, label: string) => {
    const button = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button')
    ).find((candidate) => candidate.textContent?.trim() === label)
    expect(button, `button: ${label}`).not.toBeUndefined()
    await act(async () => {
      button?.click()
      await Promise.resolve()
    })
    return button!
  }

  beforeEach(() => {
    Object.values(fetchMock).forEach((mock) => mock.mockReset())
    toastMock.mockReset()
  })

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    root = undefined
    dom?.window.close()
    dom = undefined
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('uses a master-detail layout without a separate management column', async () => {
    const container = await renderAdmin()

    expect(container.querySelector('table')).toBeNull()
    expect(container.textContent).toContain('可爱猫猫')
    expect(container.textContent).toContain('cute_cats')
    expect(container.textContent).not.toContain('管理操作')
    expect(container.querySelector('[role="tablist"]')).not.toBeNull()
  })

  it('gives server-rendered HeroUI Select controls stable ids', async () => {
    const container = await renderAdmin()

    expect(
      container.querySelector('#admin-sticker-pack-selector')
    ).not.toBeNull()
    expect(container.querySelector('#admin-sticker-pack-cover')).not.toBeNull()

    await clickButton(container, '导入 Sticker')

    expect(
      container.querySelector('#admin-sticker-import-target-pack')
    ).not.toBeNull()
  })

  it('keeps dirty settings actionable across tabs and confirms pack changes', async () => {
    const container = await renderAdmin()
    const nameInput = container.querySelector<HTMLInputElement>(
      'input[aria-label="展示名称"]'
    )
    expect(nameInput).not.toBeNull()

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        dom!.window.HTMLInputElement.prototype,
        'value'
      )?.set
      valueSetter?.call(nameInput, '新的猫猫名称')
      nameInput!.dispatchEvent(
        new dom!.window.Event('input', { bubbles: true })
      )
    })

    await clickButton(container, 'Sticker 1')
    expect(container.textContent).toContain('未保存')
    expect(
      Array.from(container.querySelectorAll('button')).some(
        (button) => button.textContent?.trim() === '保存'
      )
    ).toBe(true)

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="pack-option-困困熊"]')
        ?.click()
    })

    expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
      '放弃未保存的更改？'
    )
    expect(container.querySelector('header h2')?.textContent).toBe('可爱猫猫')

    await clickButton(container, '继续编辑')
    expect(container.querySelector('[role="dialog"]')).toBeNull()

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="pack-option-困困熊"]')
        ?.click()
    })
    await clickButton(container, '放弃更改')

    expect(container.querySelector('header h2')?.textContent).toBe('困困熊')
    expect(container.textContent).not.toContain('新的猫猫名称')
  })

  it('uses batch selection and blocks physical deletion while a Pack is active', async () => {
    const container = await renderAdmin()
    const deletePackButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button')
    ).find((button) => button.textContent?.trim() === '删除 Pack')

    expect(deletePackButton?.disabled).toBe(true)
    expect(
      deletePackButton?.closest<HTMLElement>('[data-tooltip]')?.dataset.tooltip
    ).toContain('请先下架 Pack')

    await clickButton(container, 'Sticker 1')
    const stickerCard = container.querySelector<HTMLElement>(
      '[role="button"][aria-label="选择 猫猫一号"]'
    )
    expect(stickerCard).not.toBeNull()

    await act(async () => {
      stickerCard?.click()
    })

    const deleteStickerButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button')
    ).find((button) => button.textContent?.trim() === '删除')
    expect(deleteStickerButton?.disabled).toBe(true)
    expect(
      deleteStickerButton?.closest<HTMLElement>('[data-tooltip]')?.dataset
        .tooltip
    ).toContain('请先下架 Pack')
    expect(container.textContent).toContain('可用')
    expect(container.querySelectorAll('[role="switch"]')).toHaveLength(1)
  })

  it('keeps the current Pack open after importing and shows the selected files', async () => {
    const importedPack: AdminStickerPack = {
      ...activePack,
      stickers: [...activePack.stickers, makeSticker('cat_two', '猫猫二号')]
    }
    fetchMock.kunFetchFormData.mockResolvedValueOnce(importedPack)

    const container = await renderAdmin([activePack])
    await clickButton(container, 'Sticker 1')
    await clickButton(container, '添加 Sticker')

    const fileInput =
      container.querySelector<HTMLInputElement>('input[type="file"]')
    expect(fileInput).not.toBeNull()
    expect(container.textContent).toContain('ZIP ≤ 32 MB')
    const file = new dom!.window.File(['sticker'], 'cat_two.webp', {
      type: 'image/webp'
    })
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: [file]
    })

    await act(async () => {
      fileInput!.dispatchEvent(
        new dom!.window.Event('change', { bubbles: true })
      )
    })
    expect(container.textContent).toContain('cat_two.webp')

    await clickButton(container, '导入')
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(container.textContent).toContain('猫猫二号')
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: '已导入 1 个 Sticker' })
    )
  })

  it('keeps per-file import failures visible for correction', async () => {
    fetchMock.kunFetchFormData.mockResolvedValueOnce(
      'Sticker 导入失败：\n- broken.webm: WebM 必须使用 VP9 编码'
    )

    const container = await renderAdmin([activePack])
    await clickButton(container, 'Sticker 1')
    await clickButton(container, '添加 Sticker')

    const fileInput =
      container.querySelector<HTMLInputElement>('input[type="file"]')
    const file = new dom!.window.File(['broken'], 'broken.webm', {
      type: 'video/webm'
    })
    Object.defineProperty(fileInput, 'files', {
      configurable: true,
      value: [file]
    })

    await act(async () => {
      fileInput!.dispatchEvent(
        new dom!.window.Event('change', { bubbles: true })
      )
    })
    await clickButton(container, '导入')
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.querySelector('[role="dialog"]')).not.toBeNull()
    expect(container.textContent).toContain(
      'broken.webm: WebM 必须使用 VP9 编码'
    )
  })

  it('shows HeroUI field errors before creating an invalid Pack', async () => {
    const container = await renderAdmin()
    await clickButton(container, '新建 Pack')
    await clickButton(container, '创建')

    expect(container.textContent).toContain('Pack 标识不能为空')
    expect(container.textContent).toContain('Pack 展示名称不能为空')
    expect(fetchMock.kunFetchPost).not.toHaveBeenCalled()
  })
})
