import { NextRequest, NextResponse } from 'next/server'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import {
  patchSubmissionApproveSchema,
  patchSubmissionRejectSchema
} from '~/validations/patchSubmission'
import { PatchSubmissionError } from '~/app/api/patch-submission/quota'
import {
  approvePatchSubmission,
  rejectPatchSubmission,
  requestPatchSubmissionChanges,
  violatePatchSubmission
} from '~/app/api/patch-submission/review'

const privateJson = (body: unknown) =>
  NextResponse.json(body, { headers: { 'Cache-Control': 'private, no-store' } })

/**
 * All four review actions share one handler so the permission checks, the
 * self-review rule and the reason requirement cannot drift apart between them.
 *
 * These paths settle deposits, so none of them carries a Redis rate limit: the
 * database state machine and the settlement idempotency keys are the guard.
 */
export const POST = async (
  req: NextRequest,
  { params }: { params: Promise<{ action: string }> }
) => {
  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return privateJson('用户未登录')
  }

  const { action } = await params
  if (
    action !== 'approve' &&
    action !== 'reject' &&
    action !== 'request-changes' &&
    action !== 'violate'
  ) {
    return privateJson('操作不存在')
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return privateJson('请求体不正确')
  }

  const reviewer = {
    uid: payload.uid,
    name: payload.name,
    role: payload.role
  }

  try {
    if (action === 'approve') {
      const parsed = patchSubmissionApproveSchema.safeParse(body)
      if (!parsed.success) {
        return privateJson(parsed.error.errors[0]?.message ?? '参数不正确')
      }
      return privateJson(
        await approvePatchSubmission(
          parsed.data.submissionId,
          reviewer,
          parsed.data.overrideSelfReview
        )
      )
    }

    const parsed = patchSubmissionRejectSchema.safeParse(body)
    if (!parsed.success) {
      return privateJson(parsed.error.errors[0]?.message ?? '参数不正确')
    }
    const { submissionId, reason, overrideSelfReview } = parsed.data

    if (action === 'reject') {
      return privateJson(
        await rejectPatchSubmission(
          submissionId,
          reviewer,
          reason,
          overrideSelfReview
        )
      )
    }
    if (action === 'request-changes') {
      return privateJson(
        await requestPatchSubmissionChanges(
          submissionId,
          reviewer,
          reason,
          overrideSelfReview
        )
      )
    }
    return privateJson(
      await violatePatchSubmission(
        submissionId,
        reviewer,
        reason,
        overrideSelfReview
      )
    )
  } catch (error) {
    if (error instanceof PatchSubmissionError) {
      return privateJson(error.message)
    }
    throw error
  }
}
