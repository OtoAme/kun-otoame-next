'use client'

import { useCallback, useEffect, useRef } from 'react'
import { kunFetchPut } from '~/utils/kunFetch'
import { usePatchSubmissionStore } from '~/store/patchSubmissionStore'
import type { PatchSubmissionPayload } from '~/types/api/patchSubmission'

const DEBOUNCE_MS = 1200

/**
 * Debounced cloud autosave.
 *
 * The revision is an optimistic lock, so a conflict means another device saved
 * first. That is surfaced as its own state rather than retried: retrying would
 * overwrite whatever the other device wrote, which is the failure the lock
 * exists to prevent.
 */
export const usePatchSubmissionAutosave = () => {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlight = useRef<Promise<void> | null>(null)

  const save = useCallback(async (payload: PatchSubmissionPayload) => {
    const { submissionId, revision, setSaveState, setRevision, setPendingSave } =
      usePatchSubmissionStore.getState()
    if (!submissionId) {
      return
    }

    setSaveState('saving')
    setPendingSave(true)

    const request = (async () => {
      try {
        const response = await kunFetchPut<
          string | { revision: number }
        >('/patch-submission', {
          submissionId,
          revision,
          payload,
          externalSource: ''
        })

        if (typeof response === 'string') {
          setSaveState(
            response.includes('其他设备') ? 'conflict' : 'error',
            response
          )
          return
        }

        setRevision(response.revision)
        setSaveState('saved')
      } catch (error) {
        console.error('Failed to autosave the submission draft', error)
        setSaveState('error', '保存失败, 请检查网络')
      } finally {
        setPendingSave(false)
      }
    })()

    inFlight.current = request
    await request
  }, [])

  /** Queues a save; repeated edits collapse into one request. */
  const queueSave = useCallback(
    (payload: PatchSubmissionPayload) => {
      if (timer.current) {
        clearTimeout(timer.current)
      }
      timer.current = setTimeout(() => {
        void save(payload)
      }, DEBOUNCE_MS)
    },
    [save]
  )

  /** Submitting must not race the debounce, or it would freeze a stale payload. */
  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
      await save(usePatchSubmissionStore.getState().payload)
      return
    }
    if (inFlight.current) {
      await inFlight.current
    }
  }, [save])

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current)
      }
    },
    []
  )

  return { queueSave, flush }
}
