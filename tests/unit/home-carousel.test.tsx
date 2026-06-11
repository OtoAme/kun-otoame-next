import React, { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import type { HomeCarouselMetadata } from '~/components/home/carousel/mdx'

globalThis.React = React

type DragEndHandler = (
  event: unknown,
  info: {
    offset: { x: number }
    velocity: { x: number }
  }
) => void

const framerMotionMock = vi.hoisted(() => ({
  onDragEnd: undefined as DragEndHandler | undefined
}))

vi.mock('next/image', () => ({
  default: ({
    alt,
    src,
    fill: _fill,
    priority: _priority,
    unoptimized: _unoptimized,
    ...props
  }: {
    alt: string
    src: string
    [key: string]: unknown
  }) => <img alt={alt} src={src} {...props} />
}))

vi.mock('@bprogress/next', () => ({
  useRouter: () => ({ push: vi.fn() })
}))

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn() }
}))

vi.mock('@heroui/react', () => ({
  Button: ({
    children,
    onPress,
    as: _as,
    color: _color,
    fullWidth: _fullWidth,
    isExternal: _isExternal,
    size: _size,
    startContent: _startContent,
    variant: _variant,
    ...props
  }: {
    children?: React.ReactNode
    onPress?: () => void
    [key: string]: unknown
  }) => (
    <button type="button" onClick={onPress} {...props}>
      {children}
    </button>
  ),
  Card: ({
    children,
    ...props
  }: {
    children?: React.ReactNode
    [key: string]: unknown
  }) => (
    <div {...props}>{children}</div>
  ),
  Chip: ({
    children,
    color: _color,
    size: _size,
    variant: _variant,
    ...props
  }: {
    children?: React.ReactNode
    [key: string]: unknown
  }) => (
    <span {...props}>{children}</span>
  ),
  Link: ({
    children,
    href,
    color: _color,
    isExternal: _isExternal,
    ...props
  }: {
    children?: React.ReactNode
    href?: string
    [key: string]: unknown
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  )
}))

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
  motion: {
    div: ({
      children,
      onDragEnd,
      variants: _variants,
      transition: _transition,
      drag: _drag,
      dragConstraints: _dragConstraints,
      dragElastic: _dragElastic,
      custom: _custom,
      initial: _initial,
      animate: _animate,
      exit: _exit,
      ...props
    }: {
      children?: React.ReactNode
      [key: string]: unknown
    }) => {
      framerMotionMock.onDragEnd = onDragEnd as DragEndHandler | undefined
      return <div {...props}>{children}</div>
    }
  }
}))

const posts: readonly HomeCarouselMetadata[] = [
  {
    title: '第一张',
    banner: '/first.webp',
    description: '第一张简介',
    date: '2026-01-01T00:00:00.000Z',
    authorName: '作者一',
    authorAvatar: '/avatar-one.webp',
    pin: true,
    directory: 'notice',
    link: '/doc/notice/first'
  },
  {
    title: '第二张',
    banner: '/second.webp',
    description: '第二张简介',
    date: '2026-01-02T00:00:00.000Z',
    authorName: '作者二',
    authorAvatar: '/avatar-two.webp',
    pin: true,
    directory: 'notice',
    link: '/doc/notice/second'
  },
  {
    title: '第三张',
    banner: '/third.webp',
    description: '第三张简介',
    date: '2026-01-03T00:00:00.000Z',
    authorName: '作者三',
    authorAvatar: '/avatar-three.webp',
    pin: true,
    directory: 'notice',
    link: '/doc/notice/third'
  }
]

describe('KunCarousel', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    root = undefined
    dom?.window.close()
    dom = undefined
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('restarts auto advance timing after manual navigation', async () => {
    vi.useFakeTimers()
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })
    Object.defineProperty(dom.window.document, 'visibilityState', {
      configurable: true,
      value: 'visible'
    })

    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('Image', dom.window.Image)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    const { KunCarousel } = await import(
      '~/components/home/carousel/KunCarousel'
    )

    const container = dom.window.document.getElementById('root')
    expect(container).not.toBeNull()

    root = createRoot(container!)
    await act(async () => {
      root!.render(<KunCarousel posts={posts} />)
    })

    expect(container!.textContent).toContain('第一张')

    await act(async () => {
      vi.advanceTimersByTime(4000)
    })

    const nextButton = dom.window.document.querySelector(
      'button[aria-label="下一张幻灯片"]'
    )
    expect(nextButton).not.toBeNull()

    await act(async () => {
      nextButton!.dispatchEvent(
        new dom!.window.MouseEvent('click', { bubbles: true })
      )
    })

    expect(container!.textContent).toContain('第二张')

    await act(async () => {
      vi.advanceTimersByTime(1000)
    })

    expect(container!.textContent).toContain('第二张')
    expect(container!.textContent).not.toContain('第三张')

    await act(async () => {
      vi.advanceTimersByTime(4000)
    })

    expect(container!.textContent).toContain('第三张')
  })

  it('restarts auto advance timing after an unfinished manual drag', async () => {
    vi.useFakeTimers()
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })
    Object.defineProperty(dom.window.document, 'visibilityState', {
      configurable: true,
      value: 'visible'
    })

    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('Image', dom.window.Image)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    const { KunCarousel } = await import(
      '~/components/home/carousel/KunCarousel'
    )

    const container = dom.window.document.getElementById('root')
    expect(container).not.toBeNull()

    root = createRoot(container!)
    await act(async () => {
      root!.render(<KunCarousel posts={posts} />)
    })

    expect(container!.textContent).toContain('第一张')

    await act(async () => {
      vi.advanceTimersByTime(4000)
    })

    expect(framerMotionMock.onDragEnd).toBeTypeOf('function')

    await act(async () => {
      framerMotionMock.onDragEnd?.(
        new dom!.window.MouseEvent('mouseup', { bubbles: true }),
        {
          offset: { x: 1 },
          velocity: { x: 1 }
        }
      )
    })

    await act(async () => {
      vi.advanceTimersByTime(1000)
    })

    expect(container!.textContent).toContain('第一张')
    expect(container!.textContent).not.toContain('第二张')

    await act(async () => {
      vi.advanceTimersByTime(4000)
    })

    expect(container!.textContent).toContain('第二张')
  })
})
