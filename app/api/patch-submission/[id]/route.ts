import { NextRequest, NextResponse } from 'next/server'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { patchSubmissionIdSchema } from '~/validations/patchSubmission'
import { PatchSubmissionError } from '../quota'
import {
  deletePatchSubmissionDraft,
  getPatchSubmission,
  hidePatchSubmission
} from '../service'
import { checkPatchSubmissionRateLimit } from '../rateLimit'

const privateJson = (body: unknown) =>
  NextResponse.json(body, { headers: { 'Cache-Control': 'private, no-store' } })

const parseSubmissionId = (params: { id: string }) => {
  const parsed = patchSubmissionIdSchema.safeParse({ submissionId: params.id })
  return parsed.success ? parsed.data.submissionId : null
}

export const GET = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return privateJson('用户未登录')
  }

  const limited = await checkPatchSubmissionRateLimit('read', payload.uid)
  if (limited) {
    return privateJson(limited)
  }

  const submissionId = parseSubmissionId(await params)
  if (!submissionId) {
    return privateJson('投稿 ID 不正确')
  }

  return privateJson(await getPatchSubmission(submissionId, payload.uid))
}

/**
 * Deleting an active draft returns its deposit, so this path carries no rate
 * limit at all: a 429 here would strand someone's points behind a counter.
 */
export const DELETE = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return privateJson('用户未登录')
  }

  const submissionId = parseSubmissionId(await params)
  if (!submissionId) {
    return privateJson('投稿 ID 不正确')
  }

  try {
    const result = await deletePatchSubmissionDraft(submissionId, payload.uid)
    return privateJson({ moemoepointBalance: result.balance })
  } catch (error) {
    if (error instanceof PatchSubmissionError) {
      return privateJson(error.message)
    }
    throw error
  }
}

/** Terminal records leave the author's list without touching the deposit. */
export const PATCH = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return privateJson('用户未登录')
  }

  const submissionId = parseSubmissionId(await params)
  if (!submissionId) {
    return privateJson('投稿 ID 不正确')
  }

  return privateJson(await hidePatchSubmission(submissionId, payload.uid))
}
