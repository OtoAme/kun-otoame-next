'use client'

import { useCallback, useEffect, useRef } from 'react'
import { kunFetchPut } from '~/utils/kunFetch'
import { usePatchSubmissionStore } from '~/store/patchSubmissionStore'
import type { PatchSubmissionPayload } from '~/types/api/patchSubmission'

const DEBOUNCE_MS = 1200

export type PatchSubmissionSaveResult =
  | { ok: true }
  | {
      ok: false
      reason: 'conflict' | 'error'
      message: string
    }

const OK: PatchSubmissionSaveResult = { ok: true }

/**
 * Debounced cloud autosave with one request chain per mounted editor.
 *
 * The revision is read only when a queued request starts, after the previous
 * request has written its new revision into the store. A conflict remains dirty
 * and is never retried automatically, because doing so would defeat the lock.
 */
export const usePatchSubmissionAutosave = () => {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chain = useRef<Promise<PatchSubmissionSaveResult>>(Promise.resolve(OK))
  const latestPayload = useRef<PatchSubmissionPayload | null>(null)
  const latestVersion = useRef(0)
  const savedVersion = useRef(0)
  const scheduledVersion = useRef(0)
  const running = useRef(0)
  const conflictVersion = useRef(0)
  const lastResult = useRef<PatchSubmissionSaveResult>(OK)

  const syncPendingState = useCallback(() => {
    usePatchSubmissionStore
      .getState()
      .setPendingSave(savedVersion.current < latestVersion.current)
  }, [])

  const performSave = useCallback(
    async (
      payload: PatchSubmissionPayload,
      version: number
    ): Promise<PatchSubmissionSaveResult> => {
      const { submissionId, revision, setSaveState, setRevision } =
        usePatchSubmissionStore.getState()
      if (!submissionId) {
        const result: PatchSubmissionSaveResult = {
          ok: false,
          reason: 'error',
          message: '投稿尚未加载完成'
        }
        setSaveState('error', result.message)
        return result
      }

      setSaveState('saving')

      try {
        const response = await kunFetchPut<string | { revision: number }>(
          '/patch-submission',
          {
            submissionId,
            revision,
            payload,
            externalSource: ''
          }
        )

        if (typeof response === 'string') {
          const conflict = response.includes('其他设备')
          const result: PatchSubmissionSaveResult = {
            ok: false,
            reason: conflict ? 'conflict' : 'error',
            message: response
          }
          if (conflict) conflictVersion.current = version
          setSaveState(conflict ? 'conflict' : 'error', response)
          return result
        }

        setRevision(response.revision)
        savedVersion.current = Math.max(savedVersion.current, version)
        conflictVersion.current = 0
        setSaveState('saved')
        return OK
      } catch (error) {
        console.error('Failed to autosave the submission draft', error)
        const result: PatchSubmissionSaveResult = {
          ok: false,
          reason: 'error',
          message:
            error instanceof Error && error.message
              ? `保存失败：${error.message}`
              : '保存失败，请检查网络'
        }
        setSaveState('error', result.message)
        return result
      }
    },
    []
  )

  const enqueueSave = useCallback(
    (payload: PatchSubmissionPayload, version: number) => {
      running.current += 1
      syncPendingState()

      const request = chain.current.then(
        () => performSave(payload, version),
        () => performSave(payload, version)
      )
      chain.current = request.then((result) => {
        running.current -= 1
        lastResult.current = result
        syncPendingState()
        return result
      })
      return chain.current
    },
    [performSave, syncPendingState]
  )

  const startScheduledSave = useCallback(() => {
    timer.current = null
    const payload = latestPayload.current
    const version = scheduledVersion.current
    if (!payload || version <= savedVersion.current) return chain.current
    return enqueueSave(payload, version)
  }, [enqueueSave])

  /** Repeated edits collapse into one scheduled request. */
  const queueSave = useCallback(
    (payload: PatchSubmissionPayload) => {
      latestPayload.current = payload
      latestVersion.current += 1
      scheduledVersion.current = latestVersion.current
      syncPendingState()

      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        void startScheduledSave()
      }, DEBOUNCE_MS)
    },
    [startScheduledSave, syncPendingState]
  )

  /**
   * Waits for every older request and saves the newest dirty payload. A network
   * error can be retried explicitly; an unchanged conflict is returned without
   * issuing another guaranteed-to-conflict request.
   */
  const flush = useCallback(async (): Promise<PatchSubmissionSaveResult> => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
      await startScheduledSave()
    } else if (running.current > 0) {
      await chain.current
    }

    if (savedVersion.current >= latestVersion.current) return OK

    if (conflictVersion.current === latestVersion.current) {
      return lastResult.current
    }

    const payload = latestPayload.current
    if (!payload) return OK
    return enqueueSave(payload, latestVersion.current)
  }, [enqueueSave, startScheduledSave])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
    },
    []
  )

  return { queueSave, flush }
}
