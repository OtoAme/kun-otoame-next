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

    expect(resourceColumns.slice(0, 2)).toEqual([
      { name: '资源', id: 'name' },
      { name: '类型', id: 'section' }
    ])
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
