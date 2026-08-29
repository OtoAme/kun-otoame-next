import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'

globalThis.React = React

const draftMocks = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  loadWatermark: vi.fn(),
  saveWatermark: vi.fn()
}))
vi.mock('~/utils/patchSubmissionUploadDraft', () => ({
  loadPatchSubmissionUploadDraft: draftMocks.load,
  savePatchSubmissionUploadDraft: draftMocks.save,
  loadPatchSubmissionWatermark: draftMocks.loadWatermark,
  savePatchSubmissionWatermark: draftMocks.saveWatermark
}))

const fetchMocks = vi.hoisted(() => ({
  formData: vi.fn(),
  patch: vi.fn(),
  deleteBody: vi.fn()
}))
vi.mock('~/utils/kunFetch', () => ({
  kunFetchFormData: fetchMocks.formData,
  kunFetchPatch: fetchMocks.patch,
  kunFetchDeleteBody: fetchMocks.deleteBody
}))

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn()
}))
vi.mock('react-hot-toast', () => ({ default: toastMocks }))

const dropzoneMocks = vi.hoisted(() => ({
  onDrop: { current: null as ((files: File[]) => Promise<void>) | null },
  disabled: { current: false }
}))
vi.mock('react-dropzone', () => ({
  useDropzone: (config: {
    disabled?: boolean
    onDrop: (files: File[]) => Promise<void>
  }) => {
    dropzoneMocks.onDrop.current = config.onDrop
    dropzoneMocks.disabled.current = Boolean(config.disabled)
    return {
      getRootProps: () => ({}),
      getInputProps: () => ({}),
      isDragActive: false
    }
  }
}))

vi.mock('@heroui/react', () => ({
  Button: ({
    children,
    onPress,
    isDisabled,
    'aria-label': ariaLabel
  }: {
    children?: React.ReactNode
    onPress?: () => void
    isDisabled?: boolean
    'aria-label'?: string
  }) => (
    <button disabled={isDisabled} aria-label={ariaLabel} onClick={onPress}>
      {children}
    </button>
  ),
  Card: ({ children }: { children: React.ReactNode }) => (
    <article>{children}</article>
  ),
  CardBody: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Checkbox: ({
    children,
    isSelected,
    isDisabled,
    onValueChange,
    'aria-label': ariaLabel
  }: {
    children?: React.ReactNode
    isSelected?: boolean
    isDisabled?: boolean
    onValueChange?: (value: boolean) => void
    'aria-label'?: string
  }) => (
    <label>
      <input
        type="checkbox"
        aria-label={ariaLabel}
        checked={Boolean(isSelected)}
        disabled={isDisabled}
        onChange={(event) => onValueChange?.(event.target.checked)}
      />
      {children}
    </label>
  ),
  Chip: ({ children }: { children?: React.ReactNode }) => (
    <span>{children}</span>
  ),
  Progress: ({ valueLabel }: { valueLabel?: string }) => (
    <div data-testid="upload-progress">{valueLabel}</div>
  ),
  Spinner: () => <span data-testid="spinner" />,
  Switch: ({
    children,
    isSelected,
    isDisabled,
    onValueChange
  }: {
    children?: React.ReactNode
    isSelected?: boolean
    isDisabled?: boolean
    onValueChange?: (value: boolean) => void
  }) => (
    <label>
      <input
        type="checkbox"
        role="switch"
        checked={Boolean(isSelected)}
        disabled={isDisabled}
        onChange={(event) => onValueChange?.(event.target.checked)}
      />
      {children}
    </label>
  )
}))

vi.mock('~/components/kun/image-viewer/ImageViewer', () => ({
  KunImageViewer: ({
    children
  }: {
    children: (open: (index: number) => void) => React.ReactNode
  }) => <>{children(() => undefined)}</>
}))

vi.mock('~/components/kun/NSFWMask', () => ({
  NSFWMask: () => null
}))

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

import { SubmissionGalleryInput } from '~/components/submission/SubmissionGalleryInput'
import { usePatchSubmissionStore } from '~/store/patchSubmissionStore'

const readyGallery = {
  id: 9,
  clientAssetId: 'server-client-id',
  uploadStatus: 'ready' as const,
  imageUrl: 'https://img.example.test/9.avif',
  thumbnailUrl: null,
  isNSFW: false,
  displayOrder: 0
}

const localItem = (
  overrides: Partial<{
    clientAssetId: string
    fileName: string
    status: 'pending' | 'failed'
    error: string | null
    watermark: boolean
  }> = {}
) => ({
  clientAssetId: 'stable-client-id',
  blob: new Blob(['image'], { type: 'image/jpeg' }),
  fileName: 'retry.jpg',
  mimeType: 'image/jpeg',
  lastModified: 123,
  displayOrder: 0,
  isNSFW: false,
  watermark: true,
  status: 'failed' as 'pending' | 'failed',
  error: '上次上传失败',
  ...overrides
})

const uploadResponse = (id: number, clientAssetId: string) => ({
  galleryId: id,
  alreadyUploaded: false,
  gallery: {
    id,
    clientAssetId,
    uploadStatus: 'ready' as const,
    imageUrl: `https://img.example.test/${id}.avif`,
    thumbnailUrl: null,
    isNSFW: false,
    displayOrder: 0
  }
})

describe('SubmissionGalleryInput staged uploads', () => {
  let root: Root
  let dom: JSDOM
  const revokeObjectURL = vi.fn()

  const container = () => dom.window.document.getElementById('root')!

  const findButton = (text: string) =>
    [...container().querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === text
    )

  const press = async (element: Element | null | undefined) => {
    await act(async () => {
      element?.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true })
      )
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  const drop = async (files: File[]) => {
    await act(async () => {
      await dropzoneMocks.onDrop.current?.(files)
      await Promise.resolve()
    })
  }

  const imageFile = (name: string) =>
    new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' })

  const render = async () => {
    await act(async () => {
      root.render(<SubmissionGalleryInput />)
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })
    Object.defineProperty(dom.window.URL, 'createObjectURL', {
      value: vi.fn(() => 'blob:restored-preview'),
      configurable: true
    })
    Object.defineProperty(dom.window.URL, 'revokeObjectURL', {
      value: revokeObjectURL,
      configurable: true
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('URL', dom.window.URL)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    usePatchSubmissionStore.setState({
      submissionId: 7,
      status: 'draft',
      gallery: [],
      localAssetCount: 0,
      assetUploadsInFlight: 0,
      assetDraftLoaded: false
    })
    draftMocks.load.mockResolvedValue([localItem()])
    draftMocks.save.mockResolvedValue(undefined)
    draftMocks.loadWatermark.mockResolvedValue(true)
    draftMocks.saveWatermark.mockResolvedValue(undefined)
    root = createRoot(dom.window.document.getElementById('root')!)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    vi.unstubAllGlobals()
  })

  it('restores a failed Blob, retries with the stable id, advances progress, and removes local state on success', async () => {
    const upload = deferred<ReturnType<typeof uploadResponse>>()
    fetchMocks.formData.mockReturnValue(upload.promise)

    await render()

    expect(container().textContent).toContain('上次上传失败')
    expect(container().querySelector('img')?.getAttribute('src')).toBe(
      'blob:restored-preview'
    )
    expect(usePatchSubmissionStore.getState()).toMatchObject({
      localAssetCount: 1,
      assetDraftLoaded: true
    })

    await press(
      container().querySelector('button[aria-label="重试上传 retry.jpg"]')
    )

    const sentForm = fetchMocks.formData.mock.calls[0]?.[1] as FormData
    expect(sentForm.get('clientAssetId')).toBe('stable-client-id')
    expect(container().textContent).toContain('正在上传')
    expect(container().textContent).toContain('0 / 1')
    expect(usePatchSubmissionStore.getState().assetUploadsInFlight).toBe(1)

    await act(async () => {
      upload.resolve(uploadResponse(9, 'stable-client-id'))
      await upload.promise
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container().textContent).toContain('1 / 1')
    expect(usePatchSubmissionStore.getState()).toMatchObject({
      localAssetCount: 0,
      assetUploadsInFlight: 0,
      gallery: [expect.objectContaining({ id: 9 })]
    })
    expect(draftMocks.save).toHaveBeenLastCalledWith(7, [])
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:restored-preview')
  })

  it('stages a dropped file without uploading it and offers an explicit upload action', async () => {
    draftMocks.load.mockResolvedValue([])
    await render()

    expect(findButton('上传 0 张截图')).toBeUndefined()

    await drop([imageFile('shot.jpg')])

    expect(fetchMocks.formData).not.toHaveBeenCalled()
    expect(draftMocks.save).toHaveBeenLastCalledWith(7, [
      expect.objectContaining({
        fileName: 'shot.jpg',
        status: 'pending',
        displayOrder: 0,
        watermark: true
      })
    ])
    expect(findButton('上传 1 张截图')).toBeDefined()
    expect(container().textContent).toContain('等待上传')
    expect(usePatchSubmissionStore.getState().localAssetCount).toBe(1)
  })

  it('freezes the watermark switch value into the batch that the upload press starts', async () => {
    draftMocks.load.mockResolvedValue([])
    fetchMocks.formData
      .mockResolvedValueOnce(uploadResponse(11, 'first'))
      .mockResolvedValueOnce(uploadResponse(12, 'second'))
    await render()

    await drop([imageFile('first.jpg')])
    await press(findButton('上传 1 张截图'))

    expect(fetchMocks.formData).toHaveBeenCalledTimes(1)
    expect(
      (fetchMocks.formData.mock.calls[0]?.[1] as FormData).get('watermark')
    ).toBe('true')

    await drop([imageFile('second.jpg')])
    await act(async () => {
      container()
        .querySelector('input[role="switch"]')
        ?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })
    expect(draftMocks.saveWatermark).toHaveBeenCalledWith(7, false)

    draftMocks.save.mockClear()
    await press(findButton('上传 1 张截图'))

    expect(fetchMocks.formData).toHaveBeenCalledTimes(2)
    expect(
      (fetchMocks.formData.mock.calls[1]?.[1] as FormData).get('watermark')
    ).toBe('false')
    // The frozen value is persisted before the request leaves, so an
    // interrupted batch retries with what the author chose.
    expect(draftMocks.save.mock.calls[0]?.[1]).toEqual([
      expect.objectContaining({ fileName: 'second.jpg', watermark: false })
    ])
  })

  it('keeps accepting drops while a batch is uploading', async () => {
    draftMocks.load.mockResolvedValue([
      localItem({ status: 'pending', error: null })
    ])
    const upload = deferred<ReturnType<typeof uploadResponse>>()
    fetchMocks.formData.mockReturnValue(upload.promise)
    await render()

    await press(findButton('上传 1 张截图'))
    expect(fetchMocks.formData).toHaveBeenCalledTimes(1)
    expect(dropzoneMocks.disabled.current).toBe(false)

    await drop([imageFile('late.jpg')])

    expect(fetchMocks.formData).toHaveBeenCalledTimes(1)
    expect(usePatchSubmissionStore.getState().localAssetCount).toBe(2)
    expect(draftMocks.save).toHaveBeenLastCalledWith(7, [
      expect.objectContaining({ clientAssetId: 'stable-client-id' }),
      expect.objectContaining({ fileName: 'late.jpg', status: 'pending' })
    ])

    await act(async () => {
      upload.resolve(uploadResponse(9, 'stable-client-id'))
      await upload.promise
      await Promise.resolve()
      await Promise.resolve()
    })
  })

  it('restores the persisted watermark choice on mount', async () => {
    draftMocks.load.mockResolvedValue([])
    draftMocks.loadWatermark.mockResolvedValue(false)
    await render()

    const control = container().querySelector(
      'input[role="switch"]'
    ) as HTMLInputElement
    expect(control.checked).toBe(false)

    await act(async () => {
      control.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true })
      )
      await Promise.resolve()
    })

    expect(draftMocks.saveWatermark).toHaveBeenCalledWith(7, true)
  })

  it('deletes the selected cloud rows before dropping the selected local Blobs', async () => {
    usePatchSubmissionStore.setState({ gallery: [readyGallery] })
    draftMocks.load.mockResolvedValue([
      localItem({ status: 'pending', error: null })
    ])
    fetchMocks.deleteBody.mockResolvedValue({})
    await render()

    await act(async () => {
      container()
        .querySelector('input[aria-label="选择第 1 张截图"]')
        ?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })
    await act(async () => {
      container()
        .querySelector('input[aria-label="选择待上传图片 retry.jpg"]')
        ?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    draftMocks.save.mockClear()
    await press(findButton('删除选中 (2)'))

    expect(fetchMocks.deleteBody).toHaveBeenCalledWith(
      '/patch-submission/asset',
      { submissionId: 7, galleryIds: [9] }
    )
    expect(usePatchSubmissionStore.getState()).toMatchObject({
      gallery: [],
      localAssetCount: 0
    })
    expect(draftMocks.save).toHaveBeenLastCalledWith(7, [])
  })

  it('keeps the local Blobs when the server delete fails', async () => {
    usePatchSubmissionStore.setState({ gallery: [readyGallery] })
    draftMocks.load.mockResolvedValue([
      localItem({ status: 'pending', error: null })
    ])
    fetchMocks.deleteBody.mockResolvedValue('当前状态的投稿无法修改素材')
    await render()

    await act(async () => {
      container()
        .querySelector('input[aria-label="选择第 1 张截图"]')
        ?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })
    await act(async () => {
      container()
        .querySelector('input[aria-label="选择待上传图片 retry.jpg"]')
        ?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    draftMocks.save.mockClear()
    await press(findButton('删除选中 (2)'))

    expect(toastMocks.error).toHaveBeenCalledWith('当前状态的投稿无法修改素材')
    expect(draftMocks.save).not.toHaveBeenCalled()
    expect(usePatchSubmissionStore.getState()).toMatchObject({
      gallery: [readyGallery],
      localAssetCount: 1
    })
  })
})
