import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createRoot, type Root } from 'react-dom/client'

globalThis.React = React

const kunFetchPutMock = vi.hoisted(() => vi.fn())
vi.mock('~/utils/kunFetch', () => ({ kunFetchPut: kunFetchPutMock }))

import {
  usePatchSubmissionAutosave,
  type PatchSubmissionSaveResult
} from '~/hooks/usePatchSubmissionAutosave'
import {
  emptyPatchSubmissionPayload,
  usePatchSubmissionStore
} from '~/store/patchSubmissionStore'

let controls:
  | {
      queueSave: ReturnType<typeof usePatchSubmissionAutosave>['queueSave']
      flush: ReturnType<typeof usePatchSubmissionAutosave>['flush']
    }
  | undefined

const Harness = () => {
  controls = usePatchSubmissionAutosave()
  return null
}

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('usePatchSubmissionAutosave', () => {
  let dom: JSDOM
  let root: Root

  beforeEach(async () => {
    vi.useFakeTimers()
    kunFetchPutMock.mockReset()
    dom = new JSDOM('<!doctype html><div id="root"></div>', {
      url: 'http://localhost'
    })
    vi.stubGlobal('window', dom.window)
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

    usePatchSubmissionStore.setState({
      submissionId: 1,
      revision: 1,
      payload: { ...emptyPatchSubmissionPayload },
      saveState: 'idle',
      saveError: '',
      pendingSave: false
    })

    root = createRoot(dom.window.document.getElementById('root')!)
    await act(async () => {
      root.render(<Harness />)
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    dom.window.close()
    controls = undefined
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('serializes saves and reads the revision written by the previous request', async () => {
    const first = deferred<{ revision: number }>()
    kunFetchPutMock
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({ revision: 3 })

    const firstPayload = { ...emptyPatchSubmissionPayload, name: 'first' }
    const secondPayload = { ...emptyPatchSubmissionPayload, name: 'second' }

    await act(async () => {
      controls!.queueSave(firstPayload)
      vi.advanceTimersByTime(1200)
      await Promise.resolve()
    })
    expect(kunFetchPutMock).toHaveBeenCalledTimes(1)
    expect(kunFetchPutMock.mock.calls[0]?.[1]).toMatchObject({
      revision: 1,
      payload: firstPayload
    })

    await act(async () => {
      controls!.queueSave(secondPayload)
      vi.advanceTimersByTime(1200)
      await Promise.resolve()
    })
    expect(kunFetchPutMock).toHaveBeenCalledTimes(1)

    let result: PatchSubmissionSaveResult | undefined
    await act(async () => {
      first.resolve({ revision: 2 })
      result = await controls!.flush()
    })

    expect(result).toEqual({ ok: true })
    expect(kunFetchPutMock).toHaveBeenCalledTimes(2)
    expect(kunFetchPutMock.mock.calls[1]?.[1]).toMatchObject({
      revision: 2,
      payload: secondPayload
    })
    expect(usePatchSubmissionStore.getState().revision).toBe(3)
  })

  it('returns a conflict and does not retry an unchanged conflicting payload', async () => {
    kunFetchPutMock.mockResolvedValue('投稿已在其他设备上被修改, 请刷新后重试')
    controls!.queueSave({ ...emptyPatchSubmissionPayload, name: 'conflict' })

    let firstResult: PatchSubmissionSaveResult | undefined
    await act(async () => {
      firstResult = await controls!.flush()
    })
    expect(firstResult).toEqual({
      ok: false,
      reason: 'conflict',
      message: '投稿已在其他设备上被修改, 请刷新后重试'
    })

    let secondResult: PatchSubmissionSaveResult | undefined
    await act(async () => {
      secondResult = await controls!.flush()
    })
    expect(secondResult).toEqual(firstResult)
    expect(kunFetchPutMock).toHaveBeenCalledTimes(1)
  })

  it('returns success without a request when nothing is dirty', async () => {
    let result: PatchSubmissionSaveResult | undefined
    await act(async () => {
      result = await controls!.flush()
    })

    expect(result).toEqual({ ok: true })
    expect(kunFetchPutMock).not.toHaveBeenCalled()
  })

  it('sends the actual external fetch source and timestamp without refreshing it', async () => {
    const fetchedAt = '2026-08-25T06:00:00.000Z'
    usePatchSubmissionStore.getState().setExternalProvenance('vndb', fetchedAt)
    kunFetchPutMock.mockResolvedValue({ revision: 2 })
    controls!.queueSave({ ...emptyPatchSubmissionPayload, name: 'fetched' })

    await act(async () => {
      await controls!.flush()
    })

    expect(kunFetchPutMock.mock.calls[0]?.[1]).toMatchObject({
      externalSource: 'vndb',
      externalFetchedAt: fetchedAt
    })
  })
})
