import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'

globalThis.React = React

const draftMocks = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  loadWatermark: vi.fn(),
  saveWatermark: vi.fn(),
  loadOrder: vi.fn(),
  saveOrder: vi.fn(),
  clearOrder: vi.fn()
}))
vi.mock('~/utils/patchSubmissionUploadDraft', () => ({
  loadPatchSubmissionUploadDraft: draftMocks.load,
  savePatchSubmissionUploadDraft: draftMocks.save,
  loadPatchSubmissionWatermark: draftMocks.loadWatermark,
  savePatchSubmissionWatermark: draftMocks.saveWatermark,
  loadPatchSubmissionGalleryOrder: draftMocks.loadOrder,
  savePatchSubmissionGalleryOrder: draftMocks.saveOrder,
  clearPatchSubmissionGalleryOrder: draftMocks.clearOrder
}))

/** dnd-kit needs a real pointer stack, so the drag itself is stubbed: the test
 *  drives onDragStart / onDragEnd directly and asserts what the component does
 *  with them. The overlay renders its children, so the copy that follows the
 *  pointer can be inspected. */
const dndMocks = vi.hoisted(() => ({
  onDragStart: {
    current: null as ((event: unknown) => void) | null
  },
  onDragEnd: {
    current: null as ((event: unknown) => void | Promise<void>) | null
  },
  onDragCancel: {
    current: null as (() => void) | null
  },
  modifiers: { current: [] as unknown[] },
  sensors: [] as unknown[]
}))
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({
    children,
    modifiers,
    onDragStart,
    onDragEnd,
    onDragCancel
  }: {
    children: React.ReactNode
    modifiers?: unknown[]
    onDragStart: (event: unknown) => void
    onDragEnd: (event: unknown) => void
    onDragCancel: () => void
  }) => {
    dndMocks.onDragStart.current = onDragStart
    dndMocks.onDragEnd.current = onDragEnd
    dndMocks.onDragCancel.current = onDragCancel
    dndMocks.modifiers.current = modifiers ?? []
    return <>{children}</>
  },
  DragOverlay: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="drag-overlay">{children}</div>
  ),
  closestCenter: vi.fn(),
  defaultDropAnimationSideEffects: (config: unknown) => config,
  KeyboardSensor: 'KeyboardSensor',
  PointerSensor: 'PointerSensor',
  useSensor: (sensor: unknown, options: unknown) => ({ sensor, options }),
  useSensors: (...sensors: unknown[]) => {
    dndMocks.sensors = sensors
    return sensors
  }
}))
vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  arrayMove: <T,>(items: T[], from: number, to: number) => {
    const next = [...items]
    next.splice(to, 0, ...next.splice(from, 1))
    return next
  },
  rectSortingStrategy: vi.fn(),
  sortableKeyboardCoordinates: 'sortableKeyboardCoordinates',
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    setActivatorNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false
  })
}))
vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => undefined } }
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

const viewerMocks = vi.hoisted(() => ({
  images: [] as { src: string; alt: string }[],
  opened: null as number | null
}))
vi.mock('~/components/kun/image-viewer/ImageViewer', () => ({
  KunImageViewer: ({
    images,
    children
  }: {
    images: { src: string; alt: string }[]
    children: (open: (index: number) => void) => React.ReactNode
  }) => {
    viewerMocks.images = images
    return (
      <>
        {children((index) => {
          viewerMocks.opened = index
        })}
      </>
    )
  }
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

import {
  SubmissionGalleryInput,
  type SubmissionGalleryHandle
} from '~/components/submission/SubmissionGalleryInput'
import { restrictToParentElement } from '~/utils/dndModifiers'
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
    draftMocks.loadOrder.mockResolvedValue(null)
    draftMocks.saveOrder.mockResolvedValue(undefined)
    draftMocks.clearOrder.mockResolvedValue(undefined)
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

describe('SubmissionGalleryInput order synchronization', () => {
  let root: Root
  let dom: JSDOM
  let galleryRef: React.RefObject<SubmissionGalleryHandle | null>

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

  const drag = async (from: string, to: string) => {
    await act(async () => {
      dndMocks.onDragEnd.current?.({ active: { id: from }, over: { id: to } })
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  const flushOrder = async () => {
    let result: Awaited<ReturnType<SubmissionGalleryHandle['flushOrder']>>
    await act(async () => {
      result = await galleryRef.current!.flushOrder()
    })
    return result!
  }

  const render = async () => {
    await act(async () => {
      root.render(<SubmissionGalleryInput ref={galleryRef} />)
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  const cardOrder = () =>
    [...container().querySelectorAll('img')].map((img) =>
      img.getAttribute('src')
    )

  const secondReady = {
    id: 10,
    clientAssetId: 'server-client-id-2',
    uploadStatus: 'ready' as const,
    imageUrl: 'https://img.example.test/10.avif',
    thumbnailUrl: null,
    isNSFW: false,
    displayOrder: 1
  }

  beforeEach(() => {
    vi.clearAllMocks()
    galleryRef = React.createRef<SubmissionGalleryHandle>()
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })
    Object.defineProperty(dom.window.URL, 'createObjectURL', {
      value: vi.fn(() => 'blob:restored-preview'),
      configurable: true
    })
    Object.defineProperty(dom.window.URL, 'revokeObjectURL', {
      value: vi.fn(),
      configurable: true
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('URL', dom.window.URL)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    usePatchSubmissionStore.setState({
      submissionId: 7,
      status: 'draft',
      gallery: [readyGallery, secondReady],
      localAssetCount: 0,
      assetUploadsInFlight: 0,
      assetDraftLoaded: false,
      assetOrderDirty: false
    })
    draftMocks.load.mockResolvedValue([])
    draftMocks.save.mockResolvedValue(undefined)
    draftMocks.loadWatermark.mockResolvedValue(true)
    draftMocks.saveWatermark.mockResolvedValue(undefined)
    draftMocks.loadOrder.mockResolvedValue(null)
    draftMocks.saveOrder.mockResolvedValue(undefined)
    draftMocks.clearOrder.mockResolvedValue(undefined)
    root = createRoot(dom.window.document.getElementById('root')!)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    vi.unstubAllGlobals()
  })

  it('offers a keyboard reachable drag handle with an accessible name per card', async () => {
    await render()

    const handles = [...container().querySelectorAll('button')].filter(
      (button) =>
        button.getAttribute('aria-label')?.startsWith('拖动排序') ?? false
    )
    expect(handles.map((handle) => handle.getAttribute('aria-label'))).toEqual([
      '拖动排序第 1 张截图',
      '拖动排序第 2 张截图'
    ])
    // Native buttons, so they are in the tab order and Space/Enter reach the
    // keyboard sensor without a roving tabindex of our own.
    for (const handle of handles) {
      expect(handle.tagName).toBe('BUTTON')
      expect(handle.hasAttribute('disabled')).toBe(false)
    }
    // The keyboard sensor is what makes those presses start a drag at all.
    expect(dndMocks.sensors).toContainEqual(
      expect.objectContaining({
        sensor: 'KeyboardSensor',
        options: { coordinateGetter: 'sortableKeyboardCoordinates' }
      })
    )
  })

  it('persists a drag locally without exposing a separate save action', async () => {
    await render()

    await drag('server:9', 'server:10')

    expect(fetchMocks.patch).not.toHaveBeenCalled()
    expect(draftMocks.saveOrder).toHaveBeenCalledWith(7, [
      'server:10',
      'server:9'
    ])
    expect(usePatchSubmissionStore.getState().assetOrderDirty).toBe(true)
    expect(findButton('保存排序')).toBeUndefined()
    expect(container().textContent).not.toContain('截图顺序尚未保存')
    expect(cardOrder()).toEqual([
      'https://img.example.test/10.avif',
      'https://img.example.test/9.avif'
    ])
  })

  it('can still synchronize an empty order after every screenshot is gone', async () => {
    usePatchSubmissionStore.setState({ gallery: [] })
    draftMocks.loadOrder.mockResolvedValue(['server:9'])
    fetchMocks.patch.mockResolvedValue({})
    await render()

    await flushOrder()

    expect(fetchMocks.patch).toHaveBeenCalledWith('/patch-submission/asset', {
      action: 'order',
      submissionId: 7,
      order: []
    })
    expect(draftMocks.clearOrder).toHaveBeenCalledWith(7)
    expect(usePatchSubmissionStore.getState().assetOrderDirty).toBe(false)
  })

  it('sends the whole ready set on flush and only then drops the draft', async () => {
    fetchMocks.patch.mockResolvedValue({})
    await render()
    await drag('server:9', 'server:10')

    expect(await flushOrder()).toEqual({ ok: true })

    expect(fetchMocks.patch).toHaveBeenCalledWith('/patch-submission/asset', {
      action: 'order',
      submissionId: 7,
      order: [
        { galleryId: 10, displayOrder: 0 },
        { galleryId: 9, displayOrder: 1 }
      ]
    })
    expect(draftMocks.clearOrder).toHaveBeenCalledWith(7)
    expect(usePatchSubmissionStore.getState().assetOrderDirty).toBe(false)
    // The store has to agree with what was saved, or the next render would fall
    // back to the display orders the rows had before.
    expect(cardOrder()).toEqual([
      'https://img.example.test/10.avif',
      'https://img.example.test/9.avif'
    ])
  })

  it('continues with a newer drag before an in-flight flush succeeds', async () => {
    const save = deferred<Record<string, never>>()
    const newerDraft = deferred<undefined>()
    fetchMocks.patch.mockReturnValue(save.promise)
    await render()
    await drag('server:9', 'server:10')

    let resultPromise!: ReturnType<SubmissionGalleryHandle['flushOrder']>
    await act(async () => {
      resultPromise = galleryRef.current!.flushOrder()
      await Promise.resolve()
    })
    expect(container().textContent).toContain('正在同步截图顺序')

    draftMocks.saveOrder.mockReturnValueOnce(newerDraft.promise)
    let dragPromise: void | Promise<void> = undefined
    await act(async () => {
      dragPromise = dndMocks.onDragEnd.current?.({
        active: { id: 'server:9' },
        over: { id: 'server:10' }
      })
      await Promise.resolve()
    })

    await act(async () => {
      save.resolve({})
      await save.promise
      await Promise.resolve()
    })
    // The newer sequence has not reached the draft context yet, so the flush
    // waits instead of sending and then clearing the previous keys again.
    expect(fetchMocks.patch).toHaveBeenCalledTimes(1)

    await act(async () => {
      newerDraft.resolve(undefined)
      await dragPromise
      expect(await resultPromise).toEqual({ ok: true })
    })

    expect(fetchMocks.patch).toHaveBeenCalledTimes(2)
    expect(fetchMocks.patch).toHaveBeenLastCalledWith(
      '/patch-submission/asset',
      {
        action: 'order',
        submissionId: 7,
        order: [
          { galleryId: 9, displayOrder: 0 },
          { galleryId: 10, displayOrder: 1 }
        ]
      }
    )
    expect(draftMocks.clearOrder).toHaveBeenCalledWith(7)
    expect(usePatchSubmissionStore.getState().assetOrderDirty).toBe(false)
  })

  it('keeps the dragged order and the draft when the server refuses', async () => {
    fetchMocks.patch.mockResolvedValue('截图列表已变化, 请刷新后重新排序')
    await render()
    await drag('server:9', 'server:10')

    expect(await flushOrder()).toEqual({
      ok: false,
      reason: 'error',
      message: '截图列表已变化, 请刷新后重新排序'
    })

    expect(toastMocks.error).not.toHaveBeenCalled()
    expect(draftMocks.clearOrder).not.toHaveBeenCalled()
    expect(usePatchSubmissionStore.getState().assetOrderDirty).toBe(true)
    expect(cardOrder()).toEqual([
      'https://img.example.test/10.avif',
      'https://img.example.test/9.avif'
    ])
  })

  it('restores the stored sequence on mount and stays unsaved', async () => {
    draftMocks.loadOrder.mockResolvedValue(['server:10', 'server:9'])

    await render()

    expect(cardOrder()).toEqual([
      'https://img.example.test/10.avif',
      'https://img.example.test/9.avif'
    ])
    expect(usePatchSubmissionStore.getState().assetOrderDirty).toBe(true)
    expect(fetchMocks.patch).not.toHaveBeenCalled()
  })

  it('saves the order before an upload starts and reports both stages', async () => {
    usePatchSubmissionStore.setState({ gallery: [readyGallery] })
    draftMocks.load.mockResolvedValue([
      localItem({ status: 'pending', error: null })
    ])
    fetchMocks.patch.mockResolvedValue({})
    fetchMocks.formData.mockResolvedValue(
      uploadResponse(11, 'stable-client-id')
    )
    await render()
    await drag('local:stable-client-id', 'server:9')

    await press(findButton('上传 1 张截图'))

    expect(fetchMocks.patch).toHaveBeenCalledWith('/patch-submission/asset', {
      action: 'order',
      submissionId: 7,
      order: [{ galleryId: 9, displayOrder: 1 }]
    })
    expect(fetchMocks.patch).toHaveBeenCalledBefore(fetchMocks.formData)
    expect(
      (fetchMocks.formData.mock.calls[0]?.[1] as FormData).get('displayOrder')
    ).toBe('0')
    expect(usePatchSubmissionStore.getState().assetOrderDirty).toBe(false)
  })

  it('cancels the upload when the order save fails', async () => {
    usePatchSubmissionStore.setState({ gallery: [readyGallery] })
    draftMocks.load.mockResolvedValue([
      localItem({ status: 'pending', error: null })
    ])
    fetchMocks.patch.mockResolvedValue('当前状态的投稿无法修改素材')
    await render()
    await drag('local:stable-client-id', 'server:9')

    await press(findButton('上传 1 张截图'))

    expect(fetchMocks.formData).not.toHaveBeenCalled()
    expect(toastMocks.error).toHaveBeenCalledWith('当前状态的投稿无法修改素材')
    expect(usePatchSubmissionStore.getState().assetOrderDirty).toBe(true)
  })

  it('hands the freshly uploaded row the slot its local card held', async () => {
    usePatchSubmissionStore.setState({ gallery: [] })
    draftMocks.load.mockResolvedValue([
      localItem({ status: 'pending', error: null })
    ])
    const upload = deferred<ReturnType<typeof uploadResponse>>()
    fetchMocks.formData.mockReturnValue(upload.promise)
    await render()

    await press(findButton('上传 1 张截图'))
    // A drop mid-batch writes a new sequence that still names the local card.
    await act(async () => {
      await dropzoneMocks.onDrop.current?.([
        new File([new Uint8Array([1])], 'late.jpg', { type: 'image/jpeg' })
      ])
      await Promise.resolve()
    })
    expect(draftMocks.saveOrder).toHaveBeenLastCalledWith(7, [
      'local:stable-client-id',
      expect.stringContaining('local:')
    ])

    await act(async () => {
      upload.resolve(uploadResponse(11, 'stable-client-id'))
      await upload.promise
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(draftMocks.saveOrder).toHaveBeenLastCalledWith(7, [
      'server:11',
      expect.stringContaining('local:')
    ])
    expect(cardOrder()).toEqual([
      'https://img.example.test/11.avif',
      'blob:restored-preview'
    ])
  })

  it('renders the dropped arrangement before the local write lands', async () => {
    const write = deferred<undefined>()
    draftMocks.saveOrder.mockReturnValueOnce(write.promise)
    await render()

    let dragPromise: void | Promise<void> = undefined
    await act(async () => {
      dragPromise = dndMocks.onDragEnd.current?.({
        active: { id: 'server:9' },
        over: { id: 'server:10' }
      })
      await Promise.resolve()
      await Promise.resolve()
    })

    // dnd-kit drops every drag transform on the same frame the drag ends, so a
    // sequence that only appears once localforage answers shows the cards
    // snapping back to where they were and jumping into place afterwards.
    expect(draftMocks.saveOrder).toHaveBeenCalledWith(7, [
      'server:10',
      'server:9'
    ])
    expect(cardOrder()).toEqual([
      'https://img.example.test/10.avif',
      'https://img.example.test/9.avif'
    ])
    expect(usePatchSubmissionStore.getState().assetOrderDirty).toBe(true)

    await act(async () => {
      write.resolve(undefined)
      await dragPromise
    })

    expect(cardOrder()).toEqual([
      'https://img.example.test/10.avif',
      'https://img.example.test/9.avif'
    ])
  })

  it('puts the cards back when the local write fails', async () => {
    draftMocks.saveOrder.mockRejectedValueOnce(new Error('storage is gone'))
    await render()

    await drag('server:9', 'server:10')

    // Showing an arrangement no store agrees with would be worse than refusing
    // the gesture, because nothing later would correct it.
    expect(cardOrder()).toEqual([
      'https://img.example.test/9.avif',
      'https://img.example.test/10.avif'
    ])
    expect(usePatchSubmissionStore.getState().assetOrderDirty).toBe(false)
    expect(toastMocks.error).toHaveBeenCalledWith('记录截图顺序失败，请重试')
  })

  it('synchronizes a sequence whose local write has not landed yet', async () => {
    const write = deferred<undefined>()
    draftMocks.saveOrder.mockReturnValueOnce(write.promise)
    fetchMocks.patch.mockResolvedValue({})
    await render()

    let dragPromise: void | Promise<void> = undefined
    await act(async () => {
      dragPromise = dndMocks.onDragEnd.current?.({
        active: { id: 'server:9' },
        over: { id: 'server:10' }
      })
      await Promise.resolve()
      await Promise.resolve()
    })

    let resultPromise!: ReturnType<SubmissionGalleryHandle['flushOrder']>
    await act(async () => {
      resultPromise = galleryRef.current!.flushOrder()
      await Promise.resolve()
    })
    // Reading the draft straight away would have found the previous sequence and
    // frozen that instead of the one the author is looking at.
    expect(fetchMocks.patch).not.toHaveBeenCalled()

    await act(async () => {
      write.resolve(undefined)
      await dragPromise
      expect(await resultPromise).toEqual({ ok: true })
    })

    expect(fetchMocks.patch).toHaveBeenCalledWith('/patch-submission/asset', {
      action: 'order',
      submissionId: 7,
      order: [
        { galleryId: 10, displayOrder: 0 },
        { galleryId: 9, displayOrder: 1 }
      ]
    })
  })

  it('keeps a drag inside the grid it started in', async () => {
    await render()

    expect(dndMocks.modifiers.current).toContain(restrictToParentElement)
  })

  it('follows the pointer with a copy of the card and drops it again', async () => {
    await render()

    const overlay = () =>
      container().querySelector('[data-testid="drag-overlay"]')!
    expect(overlay().children).toHaveLength(0)

    await act(async () => {
      dndMocks.onDragStart.current?.({ active: { id: 'server:9' } })
      await Promise.resolve()
    })

    const copy = overlay().firstElementChild!
    // Hidden from assistive technology: the card it was cloned from still holds
    // the real select / zoom / delete controls.
    expect(copy.getAttribute('aria-hidden')).toBe('true')
    expect(copy.querySelector('img')?.getAttribute('src')).toBe(
      'https://img.example.test/9.avif'
    )

    await act(async () => {
      dndMocks.onDragCancel.current?.()
      await Promise.resolve()
    })
    expect(overlay().children).toHaveLength(0)
  })

  it('lets the drag handle opt out of native touch gestures', async () => {
    await render()

    const handles = [...container().querySelectorAll('button')].filter((button) =>
      button.getAttribute('aria-label')?.startsWith('拖动排序')
    )
    expect(handles).toHaveLength(2)
    for (const handle of handles) {
      // Pointer event listeners cannot prevent the browser's own touch
      // behaviour, so without this the first finger movement scrolls the page
      // and cancels the pointer before a drag can start.
      expect(handle.className).toContain('touch-none')
    }
  })
})

/**
 * Every stored-state write goes through one serial queue, so the interleavings
 * below are driven by holding a storage call open and releasing it on cue: the
 * task behind it must recompute from what the task in front left behind rather
 * than from the snapshot it was triggered by.
 */
describe('SubmissionGalleryInput concurrent draft writes', () => {
  let root: Root
  let dom: JSDOM
  const revokeObjectURL = vi.fn()

  const container = () => dom.window.document.getElementById('root')!

  const findButton = (text: string) =>
    [...container().querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === text
    )

  const flush = async () => {
    await act(async () => {
      for (let tick = 0; tick < 16; tick += 1) await Promise.resolve()
    })
  }

  const press = async (element: Element | null | undefined) => {
    await act(async () => {
      element?.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true })
      )
    })
    await flush()
  }

  const imageFile = (name: string) =>
    new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' })

  const render = async () => {
    await act(async () => {
      root.render(<SubmissionGalleryInput />)
    })
    await flush()
  }

  /** Cloud cards are labelled by position, staged files by name. */
  const cardLabels = () =>
    [...container().querySelectorAll('img')].map((img) =>
      img.getAttribute('alt')
    )

  /** Parks the next call to a storage mock until the test releases it. */
  const holdNext = (mock: {
    mockReturnValueOnce: (value: unknown) => void
  }) => {
    const gate = deferred<undefined>()
    mock.mockReturnValueOnce(gate.promise)
    return () => gate.resolve(undefined)
  }

  const localFile = (
    clientAssetId: string,
    fileName: string,
    status: 'pending' | 'failed' = 'pending'
  ) => localItem({ clientAssetId, fileName, status, error: null })

  beforeEach(() => {
    vi.clearAllMocks()
    viewerMocks.images = []
    viewerMocks.opened = null
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })
    let previewSeed = 0
    Object.defineProperty(dom.window.URL, 'createObjectURL', {
      value: vi.fn(() => `blob:preview-${(previewSeed += 1)}`),
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
      assetDraftLoaded: false,
      assetOrderDirty: false
    })
    draftMocks.load.mockResolvedValue([])
    draftMocks.save.mockResolvedValue(undefined)
    draftMocks.loadWatermark.mockResolvedValue(true)
    draftMocks.saveWatermark.mockResolvedValue(undefined)
    draftMocks.loadOrder.mockResolvedValue(null)
    draftMocks.saveOrder.mockResolvedValue(undefined)
    draftMocks.clearOrder.mockResolvedValue(undefined)
    root = createRoot(dom.window.document.getElementById('root')!)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    vi.unstubAllGlobals()
  })

  it('keeps a file dropped mid-batch when the finished upload writes right behind it', async () => {
    draftMocks.load.mockResolvedValue([localFile('a', 'first.jpg')])
    const upload = deferred<ReturnType<typeof uploadResponse>>()
    fetchMocks.formData.mockReturnValue(upload.promise)
    await render()

    await press(findButton('上传 1 张截图'))
    expect(fetchMocks.formData).toHaveBeenCalledTimes(1)

    // The drop's sequence write is parked, so the upload's own write lands
    // behind it and must not be computed from the pre-drop item list.
    const releaseDropOrder = holdNext(draftMocks.saveOrder)
    let dropped: Promise<void> | undefined
    await act(async () => {
      dropped = dropzoneMocks.onDrop.current?.([imageFile('late.jpg')])
    })
    await act(async () => {
      upload.resolve(uploadResponse(11, 'a'))
      await upload.promise
    })
    await flush()

    releaseDropOrder()
    await act(async () => {
      await dropped
    })
    await flush()

    expect(draftMocks.save).toHaveBeenLastCalledWith(7, [
      expect.objectContaining({ fileName: 'late.jpg', status: 'pending' })
    ])
    expect(draftMocks.saveOrder).toHaveBeenLastCalledWith(7, [
      'server:11',
      expect.stringContaining('local:')
    ])
    expect(usePatchSubmissionStore.getState()).toMatchObject({
      localAssetCount: 1,
      gallery: [expect.objectContaining({ id: 11 })]
    })
    // The uploaded file does not come back and the dropped one is not lost.
    expect(cardLabels()).toEqual(['第 1 张截图', 'late.jpg'])
  })

  it('agrees with storage when a bulk removal and a finished upload write over each other', async () => {
    draftMocks.load.mockResolvedValue([
      localFile('a', 'first.jpg', 'failed'),
      localFile('b', 'second.jpg'),
      localFile('c', 'third.jpg')
    ])
    const upload = deferred<ReturnType<typeof uploadResponse>>()
    fetchMocks.formData.mockReturnValue(upload.promise)
    await render()

    // Selected before the batch starts, because an uploading batch locks the
    // per-card controls.
    await press(
      container().querySelector('input[aria-label="选择待上传图片 second.jpg"]')
    )
    await press(
      container().querySelector('button[aria-label="重试上传 first.jpg"]')
    )
    expect(fetchMocks.formData).toHaveBeenCalledTimes(1)

    // The removal's item write is parked, so the upload's own write lands behind
    // it and must not be computed from the pre-removal item list.
    const releaseRemoval = holdNext(draftMocks.save)
    await act(async () => {
      findButton('删除选中 (1)')?.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true })
      )
    })
    await act(async () => {
      upload.resolve(uploadResponse(11, 'a'))
      await upload.promise
    })
    await flush()

    releaseRemoval()
    await flush()

    expect(draftMocks.save).toHaveBeenLastCalledWith(7, [
      expect.objectContaining({ fileName: 'third.jpg' })
    ])
    expect(usePatchSubmissionStore.getState()).toMatchObject({
      localAssetCount: 1,
      gallery: [expect.objectContaining({ id: 11 })]
    })
    // The removed file is gone, the untouched one stayed, and the uploaded one
    // comes back as its cloud row rather than as both.
    expect(cardLabels()).toEqual(['第 1 张截图', 'third.jpg'])
  })

  it('does not let a sequence built before a promotion overwrite the promoted key', async () => {
    draftMocks.load.mockResolvedValue([localFile('a', 'first.jpg')])
    const upload = deferred<ReturnType<typeof uploadResponse>>()
    fetchMocks.formData.mockReturnValue(upload.promise)
    await render()

    await press(findButton('上传 1 张截图'))
    // A drop during the batch writes the first sequence, still naming the local
    // card.
    await act(async () => {
      await dropzoneMocks.onDrop.current?.([imageFile('second.jpg')])
    })
    await flush()
    expect(draftMocks.saveOrder).toHaveBeenLastCalledWith(7, [
      'local:a',
      expect.stringContaining('local:')
    ])

    // The promotion is parked, and a second drop meanwhile derives its sequence
    // from a grid that still shows the local card.
    const releasePromotion = holdNext(draftMocks.saveOrder)
    await act(async () => {
      upload.resolve(uploadResponse(11, 'a'))
      await upload.promise
    })
    let dropped: Promise<void> | undefined
    await act(async () => {
      dropped = dropzoneMocks.onDrop.current?.([imageFile('third.jpg')])
    })
    await flush()

    releasePromotion()
    await act(async () => {
      await dropped
    })
    await flush()

    const written = draftMocks.saveOrder.mock.calls.at(-1)?.[1] as string[]
    expect(written[0]).toBe('server:11')
    expect(written).toHaveLength(3)
    expect(written.filter((key) => key === 'local:a')).toEqual([])
    expect(container().querySelector('img')?.getAttribute('src')).toBe(
      'https://img.example.test/11.avif'
    )
  })
})

/**
 * The interleavings one serial queue cannot rule out on its own: a chain that
 * outlives the submission it belongs to, a chain that outlives the editor, and
 * a chain that decided what to write from a grid the chain in front of it had
 * not been written into yet. Each one binds its draft where it starts and has
 * to keep computing from that draft to the end.
 */
describe('SubmissionGalleryInput draft binding', () => {
  let root: Root
  let dom: JSDOM
  let unmounted = false
  let galleryRef: React.RefObject<SubmissionGalleryHandle | null>
  const revokeObjectURL = vi.fn()

  const container = () => dom.window.document.getElementById('root')!

  const findButton = (text: string) =>
    [...container().querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === text
    )

  const flush = async () => {
    await act(async () => {
      for (let tick = 0; tick < 16; tick += 1) await Promise.resolve()
    })
  }

  const press = async (element: Element | null | undefined) => {
    await act(async () => {
      element?.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true })
      )
    })
    await flush()
  }

  const imageFile = (name: string) =>
    new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' })

  const render = async () => {
    await act(async () => {
      root.render(<SubmissionGalleryInput ref={galleryRef} />)
    })
    await flush()
  }

  const startOrderFlush = async () => {
    let promise!: ReturnType<SubmissionGalleryHandle['flushOrder']>
    await act(async () => {
      promise = galleryRef.current!.flushOrder()
      await Promise.resolve()
    })
    return { promise }
  }

  const unmount = async () => {
    await act(async () => root.unmount())
    unmounted = true
  }

  /** Cloud cards are labelled by position, staged files by name. */
  const cardLabels = () =>
    [...container().querySelectorAll('img')].map((img) =>
      img.getAttribute('alt')
    )

  /** Parks the next call to a storage mock until the test releases it. */
  const holdNext = (mock: {
    mockReturnValueOnce: (value: unknown) => void
  }) => {
    const gate = deferred<undefined>()
    mock.mockReturnValueOnce(gate.promise)
    return () => gate.resolve(undefined)
  }

  const localFile = (
    clientAssetId: string,
    fileName: string,
    status: 'pending' | 'failed' = 'pending'
  ) => localItem({ clientAssetId, fileName, status, error: null })

  /** Which submission each item write named, and what it put there. */
  const savedItemIds = () =>
    draftMocks.save.mock.calls.map((call) => [
      call[0] as number,
      (call[1] as { clientAssetId: string }[]).map((item) => item.clientAssetId)
    ])

  const storedItems = () =>
    draftMocks.save.mock.calls.at(-1)?.[1] as {
      clientAssetId: string
      fileName: string
    }[]

  const storedSequence = () =>
    draftMocks.saveOrder.mock.calls.at(-1)?.[1] as string[]

  beforeEach(() => {
    vi.clearAllMocks()
    unmounted = false
    galleryRef = React.createRef<SubmissionGalleryHandle>()
    viewerMocks.images = []
    viewerMocks.opened = null
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })
    let previewSeed = 0
    Object.defineProperty(dom.window.URL, 'createObjectURL', {
      value: vi.fn(() => `blob:preview-${(previewSeed += 1)}`),
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
      assetDraftLoaded: false,
      assetOrderDirty: false
    })
    draftMocks.load.mockResolvedValue([])
    draftMocks.save.mockResolvedValue(undefined)
    draftMocks.loadWatermark.mockResolvedValue(true)
    draftMocks.saveWatermark.mockResolvedValue(undefined)
    draftMocks.loadOrder.mockResolvedValue(null)
    draftMocks.saveOrder.mockResolvedValue(undefined)
    draftMocks.clearOrder.mockResolvedValue(undefined)
    root = createRoot(dom.window.document.getElementById('root')!)
  })

  afterEach(async () => {
    if (!unmounted) await act(async () => root.unmount())
    dom.window.close()
    vi.unstubAllGlobals()
  })

  it('keeps a batch that outlived its submission writing only its own draft', async () => {
    draftMocks.load.mockImplementation(async (id: number) =>
      id === 7 ? [localFile('a', 'first.jpg')] : [localFile('b', 'second.jpg')]
    )
    const upload = deferred<ReturnType<typeof uploadResponse>>()
    fetchMocks.formData.mockReturnValue(upload.promise)
    await render()

    await press(findButton('上传 1 张截图'))
    expect(fetchMocks.formData).toHaveBeenCalledTimes(1)

    // The author moves to another submission while the first one's batch is
    // still waiting on the server.
    await act(async () => {
      usePatchSubmissionStore.setState({ submissionId: 8, gallery: [] })
    })
    await flush()
    expect(cardLabels()).toEqual(['second.jpg'])

    draftMocks.save.mockClear()
    draftMocks.saveOrder.mockClear()
    await act(async () => {
      upload.resolve(uploadResponse(11, 'a'))
      await upload.promise
    })
    await flush()

    // Submission 7's keys, holding what submission 7's own items came to.
    expect(savedItemIds()).toEqual([[7, []]])
    expect(draftMocks.saveOrder).not.toHaveBeenCalled()
    // And nothing of it reached the editor that replaced it.
    expect(usePatchSubmissionStore.getState()).toMatchObject({
      submissionId: 8,
      localAssetCount: 1,
      assetUploadsInFlight: 0,
      gallery: []
    })
    expect(cardLabels()).toEqual(['second.jpg'])
  })

  it('advances the draft after unmount so the second upload is not computed from the first', async () => {
    draftMocks.load.mockResolvedValue([
      localFile('a', 'first.jpg'),
      localFile('b', 'second.jpg')
    ])
    const first = deferred<ReturnType<typeof uploadResponse>>()
    const second = deferred<ReturnType<typeof uploadResponse>>()
    fetchMocks.formData
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    await render()

    await press(findButton('上传 2 张截图'))
    expect(fetchMocks.formData).toHaveBeenCalledTimes(1)

    await unmount()
    draftMocks.save.mockClear()

    await act(async () => {
      first.resolve(uploadResponse(11, 'a'))
      await first.promise
    })
    await flush()
    expect(fetchMocks.formData).toHaveBeenCalledTimes(2)

    await act(async () => {
      second.resolve(uploadResponse(12, 'b'))
      await second.promise
    })
    await flush()

    // The second file's writes are derived from a list the first file has
    // already left, so it is never written back in.
    expect(savedItemIds()).toEqual([
      [7, ['b']],
      [7, ['b']],
      [7, []]
    ])
  })

  it('folds a second drop into the sequence the first one had not written yet', async () => {
    await render()

    // The first drop's sequence write is parked, so the second drop queues
    // behind it and must not name its own sequence from the grid it landed on.
    const releaseFirstOrder = holdNext(draftMocks.saveOrder)
    let firstDrop: Promise<void> | undefined
    let secondDrop: Promise<void> | undefined
    await act(async () => {
      firstDrop = dropzoneMocks.onDrop.current?.([imageFile('first.jpg')])
    })
    await act(async () => {
      secondDrop = dropzoneMocks.onDrop.current?.([imageFile('second.jpg')])
    })
    await flush()

    releaseFirstOrder()
    await act(async () => {
      await Promise.all([firstDrop, secondDrop])
    })
    await flush()

    expect(storedItems().map((item) => item.fileName)).toEqual([
      'first.jpg',
      'second.jpg'
    ])
    // Both drops, in the order they were dropped.
    expect(storedSequence()).toEqual(
      storedItems().map((item) => `local:${item.clientAssetId}`)
    )
    expect(cardLabels()).toEqual(['first.jpg', 'second.jpg'])
  })

  it('rejects the second of two quick drops that would together pass the cap', async () => {
    // Nineteen slots taken, so exactly one more file fits.
    usePatchSubmissionStore.setState({
      gallery: Array.from({ length: 19 }, (_unused, index) => ({
        ...readyGallery,
        id: index + 1,
        clientAssetId: `server-client-id-${index + 1}`,
        imageUrl: `https://img.example.test/${index + 1}.avif`,
        displayOrder: index
      }))
    })
    await render()

    const releaseFirstOrder = holdNext(draftMocks.saveOrder)
    let firstDrop: Promise<void> | undefined
    let secondDrop: Promise<void> | undefined
    await act(async () => {
      firstDrop = dropzoneMocks.onDrop.current?.([imageFile('fits.jpg')])
    })
    await act(async () => {
      secondDrop = dropzoneMocks.onDrop.current?.([imageFile('over.jpg')])
    })
    await flush()

    releaseFirstOrder()
    await act(async () => {
      await Promise.all([firstDrop, secondDrop])
    })
    await flush()

    // The count is re-read inside the write, so the second drop meets the slot
    // the first one already took rather than the empty one it was dropped onto.
    expect(toastMocks.error).toHaveBeenCalledWith('截图最多 20 张')
    expect(storedItems().map((item) => item.fileName)).toEqual(['fits.jpg'])
    expect(storedSequence()).toHaveLength(20)
    expect(usePatchSubmissionStore.getState().localAssetCount).toBe(1)
    // A refused drop leaves nothing behind, its own preview included.
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview-2')
    expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:preview-1')
  })

  it('keeps a queued append on the cloud gallery of the submission that received it', async () => {
    await render()

    const releaseFirstOrder = holdNext(draftMocks.saveOrder)
    let firstDrop: Promise<void> | undefined
    let secondDrop: Promise<void> | undefined
    await act(async () => {
      firstDrop = dropzoneMocks.onDrop.current?.([imageFile('first.jpg')])
    })
    await act(async () => {
      secondDrop = dropzoneMocks.onDrop.current?.([imageFile('second.jpg')])
    })
    await flush()

    // The second append belongs to submission 7 but is still waiting behind
    // the first write when the editor switches to a nearly-full submission.
    await act(async () => {
      usePatchSubmissionStore.setState({
        submissionId: 8,
        gallery: Array.from({ length: 19 }, (_unused, index) => ({
          ...readyGallery,
          id: 100 + index,
          clientAssetId: `other-submission-${index}`,
          imageUrl: `https://img.example.test/other-${index}.avif`,
          displayOrder: index
        }))
      })
    })
    await flush()

    releaseFirstOrder()
    await act(async () => {
      await Promise.all([firstDrop, secondDrop])
    })
    await flush()

    const submissionSevenItems = draftMocks.save.mock.calls
      .filter((call) => call[0] === 7)
      .at(-1)?.[1] as { clientAssetId: string; fileName: string }[]
    const submissionSevenOrder = draftMocks.saveOrder.mock.calls
      .filter((call) => call[0] === 7)
      .at(-1)?.[1] as string[]

    expect(submissionSevenItems.map((item) => item.fileName)).toEqual([
      'first.jpg',
      'second.jpg'
    ])
    expect(submissionSevenOrder).toEqual(
      submissionSevenItems.map((item) => `local:${item.clientAssetId}`)
    )
    expect(submissionSevenOrder).not.toContain('server:100')
    expect(toastMocks.error).not.toHaveBeenCalledWith('截图最多 20 张')
  })

  it('does not let an old sequence mutation make the current order save look stale', async () => {
    draftMocks.load.mockImplementation(async (id: number) =>
      id === 8 ? [localFile('b', 'current.jpg')] : []
    )
    draftMocks.loadOrder.mockImplementation(async (id: number) =>
      id === 8 ? ['local:b'] : null
    )
    const currentSave = deferred<Record<string, never>>()
    fetchMocks.patch.mockReturnValue(currentSave.promise)
    await render()

    const releaseFirstOrder = holdNext(draftMocks.saveOrder)
    let firstDrop: Promise<void> | undefined
    let secondDrop: Promise<void> | undefined
    await act(async () => {
      firstDrop = dropzoneMocks.onDrop.current?.([imageFile('first.jpg')])
    })
    await act(async () => {
      secondDrop = dropzoneMocks.onDrop.current?.([imageFile('second.jpg')])
    })
    await flush()

    await act(async () => {
      usePatchSubmissionStore.setState({ submissionId: 8, gallery: [] })
    })
    await flush()
    const { promise: currentFlush } = await startOrderFlush()
    expect(fetchMocks.patch).toHaveBeenCalledTimes(1)

    // This advances submission 7's sequence after submission 8 froze its save.
    releaseFirstOrder()
    await act(async () => {
      await Promise.all([firstDrop, secondDrop])
    })
    await flush()

    await act(async () => {
      currentSave.resolve({})
      await currentFlush
    })
    await flush()

    expect(draftMocks.clearOrder).toHaveBeenCalledWith(8)
    expect(usePatchSubmissionStore.getState().assetOrderDirty).toBe(false)
  })

  it('does not let an old save completion release the current submission save', async () => {
    draftMocks.load.mockImplementation(async (id: number) => [
      localFile(id === 7 ? 'a' : 'b', id === 7 ? 'old.jpg' : 'current.jpg')
    ])
    draftMocks.loadOrder.mockImplementation(async (id: number) => [
      `local:${id === 7 ? 'a' : 'b'}`
    ])
    const oldSave = deferred<Record<string, never>>()
    const currentSave = deferred<Record<string, never>>()
    fetchMocks.patch
      .mockReturnValueOnce(oldSave.promise)
      .mockReturnValueOnce(currentSave.promise)
      .mockResolvedValue({})
    await render()

    const { promise: oldFlush } = await startOrderFlush()
    expect(fetchMocks.patch).toHaveBeenCalledTimes(1)

    await act(async () => {
      usePatchSubmissionStore.setState({ submissionId: 8, gallery: [] })
    })
    await flush()
    const { promise: currentFlush } = await startOrderFlush()
    expect(fetchMocks.patch).toHaveBeenCalledTimes(2)

    await act(async () => {
      oldSave.resolve({})
      await oldFlush
    })
    await flush()

    // The old request may finish, but submission 8 still owns an in-flight save.
    const { promise: repeatedCurrentFlush } = await startOrderFlush()
    expect(fetchMocks.patch).toHaveBeenCalledTimes(2)
    expect(usePatchSubmissionStore.getState().assetOrderDirty).toBe(true)

    await act(async () => {
      currentSave.resolve({})
      await Promise.all([currentFlush, repeatedCurrentFlush])
    })
    await flush()
    expect(usePatchSubmissionStore.getState().assetOrderDirty).toBe(false)
  })
})

describe('SubmissionGalleryInput restore', () => {
  let root: Root
  let dom: JSDOM
  const revokeObjectURL = vi.fn()

  const container = () => dom.window.document.getElementById('root')!

  const findButton = (text: string) =>
    [...container().querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === text
    )

  const flush = async () => {
    await act(async () => {
      for (let tick = 0; tick < 16; tick += 1) await Promise.resolve()
    })
  }

  const press = async (element: Element | null | undefined) => {
    await act(async () => {
      element?.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true })
      )
    })
    await flush()
  }

  const render = async () => {
    await act(async () => {
      root.render(<SubmissionGalleryInput />)
    })
    await flush()
  }

  const cardImages = () =>
    [...container().querySelectorAll('img')].map((img) =>
      img.getAttribute('src')
    )

  const uploadedRow = {
    id: 11,
    clientAssetId: 'stable-client-id',
    uploadStatus: 'ready' as const,
    imageUrl: 'https://img.example.test/11.avif',
    thumbnailUrl: null,
    isNSFW: false,
    displayOrder: 0
  }

  beforeEach(() => {
    vi.clearAllMocks()
    viewerMocks.images = []
    viewerMocks.opened = null
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
      assetDraftLoaded: false,
      assetOrderDirty: false
    })
    draftMocks.load.mockResolvedValue([])
    draftMocks.save.mockResolvedValue(undefined)
    draftMocks.loadWatermark.mockResolvedValue(true)
    draftMocks.saveWatermark.mockResolvedValue(undefined)
    draftMocks.loadOrder.mockResolvedValue(null)
    draftMocks.saveOrder.mockResolvedValue(undefined)
    draftMocks.clearOrder.mockResolvedValue(undefined)
    root = createRoot(dom.window.document.getElementById('root')!)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    vi.unstubAllGlobals()
  })

  it('locks the gallery and the submit gate until the stored sequence lands', async () => {
    const order = deferred<string[] | null>()
    draftMocks.load.mockResolvedValue([
      localItem({ status: 'pending', error: null })
    ])
    draftMocks.loadOrder.mockReturnValue(order.promise)

    await render()

    // The items read has already resolved; the sequence has not, so nothing may
    // be edited and the submit gate stays shut.
    expect(usePatchSubmissionStore.getState().assetDraftLoaded).toBe(false)
    expect(dropzoneMocks.disabled.current).toBe(true)
    expect(container().textContent).toContain('正在读取本地截图')
    expect(findButton('上传 1 张截图')).toBeUndefined()

    await act(async () => {
      order.resolve(['local:stable-client-id'])
      await order.promise
    })
    await flush()

    expect(usePatchSubmissionStore.getState().assetDraftLoaded).toBe(true)
    expect(dropzoneMocks.disabled.current).toBe(false)
    expect(container().textContent).not.toContain('正在读取本地截图')
    expect(findButton('上传 1 张截图')?.hasAttribute('disabled')).toBe(false)
  })

  it('keeps the gallery locked behind a retry when a stored key cannot be read', async () => {
    draftMocks.loadOrder.mockRejectedValueOnce(new Error('storage is gone'))

    await render()

    expect(usePatchSubmissionStore.getState().assetDraftLoaded).toBe(false)
    expect(dropzoneMocks.disabled.current).toBe(true)
    expect(toastMocks.error).toHaveBeenCalledWith(
      '读取本地截图草稿失败, 请重试'
    )
    expect(container().textContent).toContain('读取本地截图草稿失败')

    draftMocks.loadOrder.mockResolvedValue(null)
    await press(findButton('重试读取'))

    expect(usePatchSubmissionStore.getState().assetDraftLoaded).toBe(true)
    expect(dropzoneMocks.disabled.current).toBe(false)
    expect(findButton('重试读取')).toBeUndefined()
  })

  it('keeps every gallery write shut until the watermark preference lands', async () => {
    draftMocks.load.mockResolvedValue([
      localItem({ status: 'pending', error: null })
    ])
    draftMocks.loadOrder.mockResolvedValue(['local:stable-client-id'])
    const stored = deferred<boolean>()
    draftMocks.loadWatermark.mockReturnValue(stored.promise)

    await render()

    // A drop freezes the switch value into every file it stages, so editing
    // before that value is known would stage files against a setting about to
    // change under the author.
    expect(container().textContent).toContain('正在读取本地截图')
    expect(dropzoneMocks.disabled.current).toBe(true)
    expect(findButton('上传 1 张截图')?.hasAttribute('disabled')).toBe(true)
    // The preference is not part of the draft, so it never held the gate.
    expect(usePatchSubmissionStore.getState().assetDraftLoaded).toBe(true)

    await act(async () => {
      stored.resolve(false)
      await stored.promise
    })
    await flush()

    expect(dropzoneMocks.disabled.current).toBe(false)
    expect(
      (container().querySelector('input[role="switch"]') as HTMLInputElement)
        .checked
    ).toBe(false)
  })

  it('falls back to a watermark that is on and says so, without locking the draft', async () => {
    draftMocks.loadWatermark.mockRejectedValue(new Error('storage is gone'))

    await render()

    expect(toastMocks.error).toHaveBeenCalledWith(
      '水印设置读取失败, 已恢复为默认开启, 请确认'
    )
    expect(
      (container().querySelector('input[role="switch"]') as HTMLInputElement)
        .checked
    ).toBe(true)
    // A preference that could not be read is not a reason to freeze the draft.
    expect(usePatchSubmissionStore.getState().assetDraftLoaded).toBe(true)
    expect(dropzoneMocks.disabled.current).toBe(false)
  })

  it('resolves a half-written promotion in favour of the ready row', async () => {
    usePatchSubmissionStore.setState({ gallery: [uploadedRow] })
    draftMocks.load.mockResolvedValue([
      localItem({ status: 'pending', error: null })
    ])
    draftMocks.loadOrder.mockResolvedValue(['local:stable-client-id'])

    await render()

    // One screenshot, one card: the Blob and the row are the same picture.
    expect(cardImages()).toEqual(['https://img.example.test/11.avif'])
    expect(draftMocks.save).toHaveBeenCalledWith(7, [])
    expect(draftMocks.saveOrder).toHaveBeenCalledWith(7, ['server:11'])
    expect(usePatchSubmissionStore.getState()).toMatchObject({
      localAssetCount: 0,
      assetDraftLoaded: true,
      // The sequence is still unsaved, so it still blocks submission.
      assetOrderDirty: true
    })
  })

  it('drops the stranded local item when the sequence was already promoted', async () => {
    usePatchSubmissionStore.setState({ gallery: [uploadedRow] })
    draftMocks.load.mockResolvedValue([
      localItem({ status: 'pending', error: null })
    ])
    draftMocks.loadOrder.mockResolvedValue(['server:11'])

    await render()

    expect(cardImages()).toEqual(['https://img.example.test/11.avif'])
    expect(draftMocks.save).toHaveBeenCalledWith(7, [])
    // The sequence already said the right thing, so it is not rewritten.
    expect(draftMocks.saveOrder).not.toHaveBeenCalled()
    expect(usePatchSubmissionStore.getState()).toMatchObject({
      localAssetCount: 0,
      assetOrderDirty: true
    })
  })

  it('keeps the local Blob when the cloud row is only a failed placeholder', async () => {
    usePatchSubmissionStore.setState({
      gallery: [
        { ...uploadedRow, uploadStatus: 'failed' as const, imageUrl: null }
      ]
    })
    draftMocks.load.mockResolvedValue([localItem()])
    draftMocks.loadOrder.mockResolvedValue(['local:stable-client-id'])

    await render()

    // The bytes never landed, so the Blob is the only thing left to retry with.
    expect(cardImages()).toEqual(['blob:restored-preview'])
    expect(draftMocks.save).toHaveBeenCalledWith(7, [
      expect.objectContaining({ clientAssetId: 'stable-client-id' })
    ])
    expect(usePatchSubmissionStore.getState().localAssetCount).toBe(1)
  })

  it('offers the staged file its own zoom control and a place in the lightbox', async () => {
    usePatchSubmissionStore.setState({ gallery: [readyGallery] })
    draftMocks.load.mockResolvedValue([
      localItem({ status: 'pending', error: null })
    ])

    await render()

    const zoomNames = [...container().querySelectorAll('button')]
      .map((button) => button.getAttribute('aria-label'))
      .filter((name) => name?.startsWith('放大查看'))
    expect(zoomNames).toEqual([
      '放大查看第 1 张截图',
      '放大查看待上传图片 retry.jpg'
    ])

    // The lightbox follows the grid, so the staged file is in it too.
    expect(viewerMocks.images.map((image) => image.src)).toEqual([
      'https://img.example.test/9.avif',
      'blob:restored-preview'
    ])
    await press(
      container().querySelector(
        'button[aria-label="放大查看待上传图片 retry.jpg"]'
      )
    )
    expect(viewerMocks.opened).toBe(1)
  })
})
