import React, { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import type { AdminResource } from '~/types/api/admin'

globalThis.React = React

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    className
  }: {
    children?: React.ReactNode
    href: string
    className?: string
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  )
}))

vi.mock('@heroui/react', () => ({
  Chip: ({ children }: { children?: React.ReactNode }) => (
    <span>{children}</span>
  )
}))

vi.mock('~/components/kun/floating-card/KunUser', () => ({
  KunUser: () => <span>user</span>
}))

vi.mock('~/components/admin/resource/ResourceEdit', () => ({
  ResourceEdit: () => <button type="button">edit</button>
}))

const resource: AdminResource = {
  id: 10,
  name: '汉化包 v1.2',
  section: 'patch',
  uniqueId: 'abc12345',
  patchName: '薄樱鬼 真改',
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

describe('admin resource table cell', () => {
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

  const renderCell = async (
    targetResource: AdminResource,
    columnKey = 'name'
  ) => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })

    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    const { RenderCell } = await import(
      '~/components/admin/resource/RenderCell'
    )
    const container = dom.window.document.getElementById('root')
    expect(container).not.toBeNull()

    root = createRoot(container!)
    await act(async () => {
      root!.render(<>{RenderCell(targetResource, columnKey)}</>)
    })

    return container!
  }

  it('shows resource name first and game name as the linked secondary line', async () => {
    const container = await renderCell(resource)

    expect(container!.textContent).toContain('汉化包 v1.2')
    expect(container!.textContent).not.toContain('补丁')
    expect(container!.textContent).toContain('薄樱鬼 真改')
    const gameLink = container!.querySelector('a')
    expect(gameLink?.getAttribute('href')).toBe('/abc12345')
    expect(gameLink?.className).toContain('w-fit')
    expect(gameLink?.className).toContain('max-w-full')
  })

  it('allows long resource names and game names to wrap inside the resource column', async () => {
    const container = await renderCell({
      ...resource,
      name: '这是一个特别长的资源名称用于验证后台资源列表不会把整张表格撑出宽屏视口',
      patchName:
        '这是一个同样很长的所属游戏名称用于验证副行也会在资源列宽内自然换行'
    })

    const resourceName = container.querySelector('p')
    const gameLink = container.querySelector('a')

    expect(resourceName?.className).toContain('whitespace-normal')
    expect(resourceName?.className).toContain('[overflow-wrap:anywhere]')
    expect(resourceName?.className).not.toContain('truncate')
    expect(gameLink?.className).toContain('whitespace-normal')
    expect(gameLink?.className).toContain('[overflow-wrap:anywhere]')
    expect(gameLink?.className).not.toContain('truncate')
  })

  it('shows the resource section label in a dedicated type cell', async () => {
    const patchContainer = await renderCell(resource, 'section')
    expect(patchContainer.textContent).toBe('补丁')

    await act(async () => {
      root?.unmount()
    })
    root = undefined
    dom?.window.close()
    dom = undefined

    const resourceContainer = await renderCell(
      {
        ...resource,
        section: 'galgame',
        name: '游戏本体'
      },
      'section'
    )

    expect(resourceContainer.textContent).toBe('资源')
  })

  it('includes a type column after the resource name column', async () => {
    const { resourceColumns } = await import(
      '~/components/admin/resource/Container'
    )

    expect(resourceColumns.slice(0, 2)).toMatchObject([
      { name: '资源', id: 'name' },
      { name: '类型', id: 'section' }
    ])
  })

  it('scopes responsive width limits to the readable text columns only', async () => {
    const { resourceColumns } = await import(
      '~/components/admin/resource/Container'
    )

    const nameColumn = resourceColumns.find((column) => column.id === 'name')
    const userColumn = resourceColumns.find((column) => column.id === 'user')
    const otherColumns = resourceColumns.filter(
      (column) => column.id !== 'name' && column.id !== 'user'
    )

    expect(nameColumn?.className).toContain('max-w-[14rem]')
    expect(nameColumn?.className).toContain('xl:max-w-[26rem]')
    expect(nameColumn?.className).toContain('whitespace-normal')
    expect(userColumn?.className).toContain('min-w-[7rem]')
    expect(userColumn?.className).toContain('whitespace-normal')
    expect(otherColumns.every((column) => !('className' in column))).toBe(true)
  })

  it('does not duplicate the resource label inside the name cell for game resources', async () => {
    const container = await renderCell({
      ...resource,
      section: 'galgame',
      name: '游戏本体'
    })

    expect(container.textContent).toContain('游戏本体')
    expect(container.textContent).not.toContain('资源')
  })
})
