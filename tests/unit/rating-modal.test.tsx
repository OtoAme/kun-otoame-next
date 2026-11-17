import React, { act } from 'react'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import toast from 'react-hot-toast'
import type { KunPatchRating } from '~/types/api/galgame'

const services = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  auth: vi.fn()
}))
vi.mock('~/middleware/_verifyHeaderCookie', () => ({
  verifyHeaderCookie: services.auth
}))
vi.mock('~/app/api/patch/rating/create', () => ({
  createPatchRating: services.create
}))
vi.mock('~/app/api/patch/rating/update', () => ({
  updatePatchRating: services.update
}))
vi.mock('~/app/api/patch/rating/delete', () => ({ deletePatchRating: vi.fn() }))
vi.mock('~/app/api/patch/rating/get', async () => {
  const { z } = await import('zod')
  return { getPatchRating: vi.fn(), getPatchRatingSchema: z.object({}) }
})
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() }
}))
vi.mock('@heroui/modal', () => ({
  Modal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ModalContent: ({ children }: { children: React.ReactNode }) => (
    <div role="dialog">{children}</div>
  ),
  ModalHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ModalBody: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ModalFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  )
}))
vi.mock('@heroui/react', () => ({
  Button: ({
    children,
    onPress,
    isDisabled,
    isLoading
  }: {
    children: React.ReactNode
    onPress: () => void
    isDisabled?: boolean
    isLoading?: boolean
  }) => (
    <button disabled={isDisabled || isLoading} onClick={onPress}>
      {children}
    </button>
  ),
  Input: ({
    label,
    value,
    onValueChange
  }: {
    label: string
    value: string
    onValueChange: (value: string) => void
  }) => (
    <input
      aria-label={label}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    />
  ),
  Textarea: ({
    label,
    value,
    onValueChange
  }: {
    label: string
    value: string
    onValueChange: (value: string) => void
  }) => (
    <textarea
      aria-label={label}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    />
  ),
  Select: ({
    label,
    children
  }: {
    label: string
    children: React.ReactNode
  }) => <div aria-label={label}>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  )
}))

const rating: KunPatchRating = {
  id: 5,
  patchId: 7,
  uniqueId: 'abc12345',
  userId: 2,
  recommend: 'yes',
  overall: 8,
  playStatus: 'in_progress',
  shortSummary: '保留评价输入',
  spoilerLevel: 'none',
  isLike: false,
  likeCount: 0,
  created: '2026-01-01T00:00:00Z',
  updated: '2026-01-01T00:00:00Z',
  user: { id: 2, name: 'Synthetic', avatar: '' }
}

describe('rating form request contract and retry', () => {
  let root: Root
  let dom: JSDOM
  const requests: Record<string, unknown>[] = []
  const onSuccess = vi.fn()
  const onClose = vi.fn()
  const fetchMock = vi.fn()

  beforeEach(async () => {
    vi.clearAllMocks()
    requests.length = 0
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    services.auth.mockResolvedValue({ uid: 2, role: 1 })
    services.update.mockResolvedValue({
      ...rating,
      shortSummary: '服务器保存后的评价'
    })
    services.create.mockResolvedValue(rating)
    const { PUT, POST } = await import('~/app/api/patch/rating/route')
    fetchMock
      .mockReset()
      .mockImplementation(async (url: string, options: RequestInit) => {
        requests.push(JSON.parse(options.body as string))
        const request = new NextRequest(`http://localhost${url}`, {
          ...options,
          signal: options.signal ?? undefined
        })
        return options.method === 'PUT' ? PUT(request) : POST(request)
      })
    vi.stubGlobal('fetch', fetchMock)
    root = createRoot(dom.window.document.getElementById('root')!)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    vi.unstubAllGlobals()
  })

  const renderForm = async () => {
    const { RatingModal } = await import(
      '~/components/patch/rating/RatingModal'
    )
    await act(async () =>
      root.render(
        <RatingModal
          isOpen
          onClose={onClose}
          onSuccess={onSuccess}
          patchId={7}
          initial={rating}
        />
      )
    )
  }
  const save = () =>
    [...document.querySelectorAll('button')].find(
      (button) => button.textContent === '保存修改'
    )!

  it('submits the actual edit form without a game ID and accepts the server record', async () => {
    await renderForm()
    await act(async () => save().click())
    expect(requests).toEqual([
      {
        ratingId: 5,
        recommend: 'yes',
        overall: 8,
        playStatus: 'in_progress',
        shortSummary: '保留评价输入',
        spoilerLevel: 'none'
      }
    ])
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ shortSummary: '服务器保存后的评价' })
    )
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('keeps the draft after a business refusal and allows saving again', async () => {
    services.update.mockResolvedValueOnce('您没有权限更新该评价')
    await renderForm()
    await act(async () => save().click())
    expect(toast.error).toHaveBeenCalledWith('您没有权限更新该评价')
    expect(onClose).not.toHaveBeenCalled()
    expect(document.querySelector('textarea')?.value).toBe('保留评价输入')
    expect(save().disabled).toBe(false)
    await act(async () => save().click())
    expect(onSuccess).toHaveBeenCalledOnce()
  })

  it('keeps the draft and releases submission after a network failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await renderForm()
    await act(async () => save().click())
    expect(toast.error).toHaveBeenCalledWith('保存评价失败，请检查网络后重试')
    expect(document.querySelector('textarea')?.value).toBe('保留评价输入')
    expect(save().disabled).toBe(false)
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => save().click())
    expect(onSuccess).toHaveBeenCalledOnce()
  })

  it('does not send a second request while the first is pending', async () => {
    let finish!: (value: KunPatchRating) => void
    services.update.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    await renderForm()
    await act(async () => {
      save().click()
      save().click()
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    await act(async () => finish(rating))
    expect(onSuccess).toHaveBeenCalledOnce()
  })
})
