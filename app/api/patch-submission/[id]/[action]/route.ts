import { NextRequest, NextResponse } from 'next/server'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import { patchSubmissionIdSchema } from '~/validations/patchSubmission'
import { PatchSubmissionError } from '../../quota'
import { submitPatchSubmission, withdrawPatchSubmission } from '../../submit'
import { checkPatchSubmissionRateLimit } from '../../rateLimit'

const privateJson = (body: unknown) =>
  NextResponse.json(body, { headers: { 'Cache-Control': 'private, no-store' } })

/**
 * One handler for both transitions: they share every guard, and keeping them
 * together means the pending-state rules cannot drift apart.
 */
const handle = async (
  req: NextRequest,
  params: Promise<{ id: string; action: string }>
) => {
  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return privateJson('用户未登录')
  }

  const { id, action } = await params
  if (action !== 'submit' && action !== 'withdraw') {
    return privateJson('操作不存在')
  }

  const limited = await checkPatchSubmissionRateLimit('submit', payload.uid)
  if (limited) {
    return privateJson(limited)
  }

  const parsed = patchSubmissionIdSchema.safeParse({ submissionId: id })
  if (!parsed.success) {
    return privateJson('投稿 ID 不正确')
  }

  try {
    const result =
      action === 'submit'
        ? await submitPatchSubmission(parsed.data.submissionId, payload.uid)
        : await withdrawPatchSubmission(parsed.data.submissionId, payload.uid)
    return privateJson(result)
  } catch (error) {
    if (error instanceof PatchSubmissionError) {
      return privateJson(error.message)
    }
    throw error
  }
}

export const POST = (
  req: NextRequest,
  { params }: { params: Promise<{ id: string; action: string }> }
) => handle(req, params)
