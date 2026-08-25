import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'

globalThis.React = React

const draftMocks = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn()
}))
vi.mock('~/utils/patchSubmissionUploadDraft', () => ({
  loadPatchSubmissionUploadDraft: draftMocks.load,
  savePatchSubmissionUploadDraft: draftMocks.save
}))

const fetchMocks = vi.hoisted(() => ({
  formData: vi.fn(),
  patch: vi.fn()
}))
vi.mock('~/utils/kunFetch', () => ({
  kunFetchFormData: fetchMocks.formData,
  kunFetchPatch: fetchMocks.patch
}))

vi.mock('react-dropzone', () => ({
  useDropzone: () => ({
    getRootProps: () => ({}),
    getInputProps: () => ({}),
    isDragActive: false
  })
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
  Checkbox: ({ children }: { children?: React.ReactNode }) => (
    <span>{children}</span>
  ),
  Chip: ({ children }: { children?: React.ReactNode }) => (
    <span>{children}</span>
  ),
  Progress: ({ valueLabel }: { valueLabel?: string }) => (
    <div data-testid="upload-progress">{valueLabel}</div>
  ),
  Spinner: () => <span data-testid="spinner" />,
  Switch: ({ children }: { children?: React.ReactNode }) => (
    <span>{children}</span>
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

describe('SubmissionGalleryInput persistent retry', () => {
  let root: Root
  let dom: JSDOM
  const revokeObjectURL = vi.fn()

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
    draftMocks.load.mockResolvedValue([
      {
        clientAssetId: 'stable-client-id',
        blob: new Blob(['image'], { type: 'image/jpeg' }),
        fileName: 'retry.jpg',
        mimeType: 'image/jpeg',
        lastModified: 123,
        displayOrder: 0,
        isNSFW: false,
        watermark: true,
        status: 'failed',
        error: '上次上传失败'
      }
    ])
    draftMocks.save.mockResolvedValue(undefined)
    root = createRoot(dom.window.document.getElementById('root')!)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    vi.unstubAllGlobals()
  })

  it('restores a failed Blob, retries with the stable id, advances progress, and removes local state on success', async () => {
    const upload = deferred<{
      galleryId: number
      alreadyUploaded: boolean
      gallery: {
        id: number
        clientAssetId: string
        uploadStatus: 'ready'
        imageUrl: string
        thumbnailUrl: null
        isNSFW: boolean
        displayOrder: number
      }
    }>()
    fetchMocks.formData.mockReturnValue(upload.promise)

    await act(async () => {
      root.render(<SubmissionGalleryInput />)
      await Promise.resolve()
      await Promise.resolve()
    })

    const container = dom.window.document.getElementById('root')!
    expect(container.textContent).toContain('上次上传失败')
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      'blob:restored-preview'
    )
    expect(usePatchSubmissionStore.getState()).toMatchObject({
      localAssetCount: 1,
      assetDraftLoaded: true
    })

    await act(async () => {
      container
        .querySelector('button[aria-label="重试上传 retry.jpg"]')
        ?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    const sentForm = fetchMocks.formData.mock.calls[0]?.[1] as FormData
    expect(sentForm.get('clientAssetId')).toBe('stable-client-id')
    expect(container.textContent).toContain('正在上传')
    expect(container.textContent).toContain('0 / 1')
    expect(usePatchSubmissionStore.getState().assetUploadsInFlight).toBe(1)

    await act(async () => {
      upload.resolve({
        galleryId: 9,
        alreadyUploaded: false,
        gallery: {
          id: 9,
          clientAssetId: 'stable-client-id',
          uploadStatus: 'ready',
          imageUrl: 'https://img.example.test/9.avif',
          thumbnailUrl: null,
          isNSFW: false,
          displayOrder: 0
        }
      })
      await upload.promise
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('1 / 1')
    expect(usePatchSubmissionStore.getState()).toMatchObject({
      localAssetCount: 0,
      assetUploadsInFlight: 0,
      gallery: [expect.objectContaining({ id: 9 })]
    })
    expect(draftMocks.save).toHaveBeenLastCalledWith(7, [])
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:restored-preview')
  })
})
