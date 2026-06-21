import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'

globalThis.React = React

const fetchMock = vi.hoisted(() => ({
  kunFetchFormData: vi.fn()
}))

const localforageMock = vi.hoisted(() => ({
  getItem: vi.fn(),
  removeItem: vi.fn()
}))

const toastMock = vi.hoisted(() => ({
  toast: vi.fn(),
  error: vi.fn(),
  success: vi.fn()
}))

const routerMock = vi.hoisted(() => ({
  push: vi.fn()
}))

vi.mock('~/utils/kunFetch', () => ({
  kunFetchFormData: fetchMock.kunFetchFormData
}))

vi.mock('localforage', () => ({
  default: localforageMock
}))

vi.mock('react-hot-toast', () => ({
  default: Object.assign(toastMock.toast, {
    error: toastMock.error,
    success: toastMock.success
  })
}))

vi.mock('@bprogress/next', () => ({
  useRouter: () => routerMock
}))

vi.mock('@heroui/react', () => ({
  Button: ({
    children,
    isDisabled,
    isLoading,
    onPress,
    ...props
  }: {
    children?: React.ReactNode
    isDisabled?: boolean
    isLoading?: boolean
    onPress?: () => void
    [key: string]: unknown
  }) => (
    <button
      {...props}
      type="button"
      disabled={Boolean(isDisabled)}
      data-loading={isLoading ? 'true' : 'false'}
      onClick={onPress}
    >
      {children}
    </button>
  )
}))

const flushPromises = async () => {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve()
  }
}

describe('PublishButton', () => {
  let root: Root | undefined
  let dom: JSDOM | undefined

  const renderPublishButton = async () => {
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })

    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('React', React)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    const { initialCreatePatchData, useCreatePatchStore } = await import(
      '~/store/editStore'
    )
    useCreatePatchStore.setState({
      data: {
        ...initialCreatePatchData,
        name: 'Test Otome',
        introduction: 'This introduction is long enough.',
        released: '2026-06-21',
        contentLimit: 'sfw'
      }
    })

    const { PublishButton } = await import(
      '~/components/edit/create/PublishButton'
    )
    const container = dom.window.document.getElementById('root')
    expect(container).not.toBeNull()

    root = createRoot(container!)
    await act(async () => {
      root!.render(<PublishButton setErrors={vi.fn()} />)
    })

    const button = dom.window.document.querySelector('button')
    expect(button).not.toBeNull()

    return button!
  }

  beforeEach(() => {
    const banner = new Blob(['banner'], { type: 'image/png' })

    fetchMock.kunFetchFormData.mockReset()
    localforageMock.getItem.mockReset()
    localforageMock.removeItem.mockReset()
    toastMock.toast.mockReset()
    toastMock.error.mockReset()
    toastMock.success.mockReset()
    routerMock.push.mockReset()

    localforageMock.getItem.mockImplementation((key: string) => {
      if (key === 'kun-patch-banner') {
        return Promise.resolve(banner)
      }
      if (key === 'kun-patch-gallery-watermark') {
        return Promise.resolve(false)
      }
      return Promise.resolve(null)
    })
    localforageMock.removeItem.mockResolvedValue(undefined)
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

  it('does not attach a short client timeout to the create request', async () => {
    fetchMock.kunFetchFormData.mockResolvedValue({
      uniqueId: 'abc12345',
      patchId: 1
    })

    const button = await renderPublishButton()

    await act(async () => {
      button.dispatchEvent(new dom!.window.MouseEvent('click', { bubbles: true }))
      await flushPromises()
    })

    expect(fetchMock.kunFetchFormData).toHaveBeenCalledWith(
      '/edit',
      expect.any(FormData)
    )
    expect(routerMock.push).toHaveBeenCalledWith('/abc12345')
  })

  it('restores the submit button and shows an error when publishing rejects', async () => {
    fetchMock.kunFetchFormData.mockRejectedValue(
      new Error('请求超时，请稍后重试')
    )

    const button = await renderPublishButton()

    await act(async () => {
      button.dispatchEvent(new dom!.window.MouseEvent('click', { bubbles: true }))
      await flushPromises()
    })

    expect(toastMock.error).toHaveBeenCalledWith('请求超时，请稍后重试')
    expect(button.disabled).toBe(false)
    expect(button.dataset.loading).toBe('false')
  })
})
