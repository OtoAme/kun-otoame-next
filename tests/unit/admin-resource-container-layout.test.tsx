import React, { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import type { AdminResource } from '~/types/api/admin'

globalThis.React = React

const tableRenderState = vi.hoisted(() => ({
  bottomContentWasProvided: false,
  columnClasses: [] as Array<{ columnName: string; className?: string }>
}))

vi.mock('~/hooks/useMounted', () => ({
  useMounted: () => true
}))

vi.mock('~/utils/kunFetch', () => ({
  kunFetchDelete: vi.fn(),
  kunFetchGet: vi.fn().mockResolvedValue({ users: [], resources: [], total: 1 })
}))

vi.mock('@heroui/react', () => ({
  Autocomplete: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="autocomplete">{children}</div>
  ),
  AutocompleteItem: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Avatar: ({ name }: { name?: string }) => <span>{name}</span>,
  Button: ({
    children,
    onPress,
    startContent
  }: {
    children?: React.ReactNode
    onPress?: () => void
    startContent?: React.ReactNode
  }) => (
    <button type="button" onClick={onPress}>
      {startContent}
      {children}
    </button>
  ),
  Chip: ({ children }: { children?: React.ReactNode }) => (
    <span>{children}</span>
  ),
  Input: ({ value, placeholder }: { value?: string; placeholder?: string }) => (
    <input aria-label={placeholder} value={value ?? ''} readOnly />
  ),
  Modal: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  ModalBody: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ModalContent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ModalFooter: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ModalHeader: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Select: ({
    children,
    'aria-label': ariaLabel
  }: {
    children?: React.ReactNode
    'aria-label'?: string
  }) => <select aria-label={ariaLabel}>{children}</select>,
  SelectItem: ({ children }: { children?: React.ReactNode }) => (
    <option>{children}</option>
  ),
  Table: ({
    children,
    bottomContent
  }: {
    children?: React.ReactNode
    bottomContent?: React.ReactNode
  }) => {
    tableRenderState.bottomContentWasProvided = bottomContent !== undefined
    return <table data-testid="admin-resource-table">{children}</table>
  },
  TableBody: ({
    children,
    items
  }: {
    children: (item: AdminResource) => React.ReactNode
    items: AdminResource[]
  }) => <tbody>{items.map((item) => children(item))}</tbody>,
  TableCell: ({ children }: { children?: React.ReactNode }) => (
    <td>{children}</td>
  ),
  TableColumn: ({
    children,
    className
  }: {
    children?: React.ReactNode
    className?: string
  }) => {
    tableRenderState.columnClasses.push({
      columnName: typeof children === 'string' ? children : '',
      className
    })
    return <th className={className}>{children}</th>
  },
  TableHeader: ({
    children,
    columns
  }: {
    children: (column: {
      id: string
      name: string
      className?: string
    }) => React.ReactNode
    columns: Array<{ id: string; name: string; className?: string }>
  }) => (
    <thead>
      <tr>{columns.map((column) => children(column))}</tr>
    </thead>
  ),
  TableRow: ({
    children,
    item
  }: {
    children: (columnKey: string) => React.ReactNode
    item?: AdminResource
  }) => (
    <tr>
      {['name', 'section', 'user', 'storage', 'size', 'created', 'actions'].map(
        (columnKey) => (
          <React.Fragment key={`${item?.id ?? 'row'}-${columnKey}`}>
            {children(columnKey)}
          </React.Fragment>
        )
      )}
    </tr>
  ),
  useDisclosure: () => ({
    isOpen: false,
    onOpen: vi.fn(),
    onClose: vi.fn()
  })
}))

vi.mock('~/components/kun/Pagination', () => ({
  KunPagination: () => <nav data-testid="admin-resource-pagination" />
}))

vi.mock('~/components/kun/Loading', () => ({
  KunLoading: ({ hint }: { hint: string }) => <div>{hint}</div>
}))

vi.mock('~/components/admin/resource/RenderCell', () => ({
  RenderCell: (_resource: AdminResource, columnKey: string) => (
    <span>{columnKey}</span>
  )
}))

vi.mock('lucide-react', () => ({
  Search: () => <span data-testid="search-icon" />,
  Trash2: () => <span data-testid="trash-icon" />,
  ChevronLeft: () => <span data-testid="left-icon" />,
  ChevronRight: () => <span data-testid="right-icon" />
}))

vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn(),
    success: vi.fn()
  }
}))

const resource: AdminResource = {
  id: 10,
  name: '资源名',
  section: 'patch',
  uniqueId: 'abc12345',
  patchName: '所属游戏',
  type: ['patch'],
  language: ['zh-Hans'],
  platform: ['windows'],
  note: '',
  links: [],
  likeCount: 0,
  download: 0,
  isLike: false,
  status: 0,
  userId: 3,
  patchId: 20,
  created: '2026-06-28T00:00:00.000Z',
  user: {
    id: 3,
    name: '资源作者',
    avatar: '',
    patchCount: 1,
    role: 2
  }
}

describe('admin resource table layout', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    root = undefined
    dom?.window.close()
    dom = undefined
    tableRenderState.bottomContentWasProvided = false
    tableRenderState.columnClasses = []
    vi.unstubAllGlobals()
  })

  const renderResourceTable = async () => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })

    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    const { Resource } = await import('~/components/admin/resource/Container')
    const container = dom.window.document.getElementById('root')
    expect(container).not.toBeNull()

    root = createRoot(container!)
    await act(async () => {
      root!.render(<Resource initialResources={[resource]} initialTotal={1} />)
    })

    return container!
  }

  it('keeps pagination outside the horizontally growing table content', async () => {
    const container = await renderResourceTable()
    const pagination = container.querySelector(
      '[data-testid="admin-resource-pagination"]'
    )

    expect(tableRenderState.bottomContentWasProvided).toBe(false)
    expect(
      container.querySelector('[data-testid="admin-resource-table"]')
    ).not.toBeNull()
    expect(pagination).not.toBeNull()
    expect(pagination?.parentElement?.className).toContain('justify-center')
    expect(pagination?.parentElement?.className).toContain('sm:col-start-2')
  })

  it('passes responsive width classes only to the resource column header', async () => {
    await renderResourceTable()

    expect(tableRenderState.columnClasses).toContainEqual(
      expect.objectContaining({
        columnName: '资源',
        className: expect.stringContaining('xl:max-w-[26rem]')
      })
    )
    expect(
      tableRenderState.columnClasses
        .filter((column) => column.columnName !== '资源')
        .every((column) => column.className === undefined)
    ).toBe(true)
  })
})
