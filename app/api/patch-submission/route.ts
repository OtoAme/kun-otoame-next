import { NextRequest, NextResponse } from 'next/server'
import {
  kunParseGetQuery,
  kunParsePostBody,
  kunParsePutBody
} from '~/app/api/utils/parseQuery'
import { verifyHeaderCookie } from '~/middleware/_verifyHeaderCookie'
import {
  patchSubmissionCreateSchema,
  patchSubmissionListSchema,
  patchSubmissionUpdateSchema
} from '~/validations/patchSubmission'
import { getCurrentBalance } from '~/app/api/moemoepoint/service'
import { prisma } from '~/prisma/index'
import { createPatchSubmissionDraft, PatchSubmissionError } from './quota'
import {
  getPatchSubmissionQuota,
  listOwnPatchSubmissions,
  updatePatchSubmissionDraft
} from './service'
import { checkPatchSubmissionRateLimit } from './rateLimit'

/** Nothing here may be cached: it is one user's private draft state. */
const privateJson = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' }
  })

export const GET = async (req: NextRequest) => {
  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return privateJson('用户未登录')
  }

  const limited = await checkPatchSubmissionRateLimit('read', payload.uid)
  if (limited) {
    return privateJson(limited)
  }

  const input = kunParseGetQuery(req, patchSubmissionListSchema)
  if (typeof input === 'string') {
    return privateJson(input)
  }

  // The balance travels with the list so the page can show what is held without
  // a second round trip.
  const [list, quota, moemoepointBalance] = await Promise.all([
    listOwnPatchSubmissions(payload.uid, input.page, input.limit),
    getPatchSubmissionQuota(payload.uid, payload.role),
    getCurrentBalance(prisma, payload.uid)
  ])

  return privateJson({ ...list, quota, moemoepointBalance })
}

export const POST = async (req: NextRequest) => {
  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return privateJson('用户未登录')
  }

  const limited = await checkPatchSubmissionRateLimit('create', payload.uid)
  if (limited) {
    return privateJson(limited)
  }

  const input = await kunParsePostBody(req, patchSubmissionCreateSchema)
  if (typeof input === 'string') {
    return privateJson(input)
  }

  try {
    const result = await createPatchSubmissionDraft({
      userId: payload.uid,
      requestId: input.requestId,
      payload: input.payload
    })

    return privateJson({
      submissionId: result.submission.id,
      status: result.submission.status,
      revision: result.submission.revision,
      moemoepointBalance: 'balance' in result ? result.balance : null
    })
  } catch (error) {
    if (error instanceof PatchSubmissionError) {
      return privateJson(error.message)
    }
    throw error
  }
}

export const PUT = async (req: NextRequest) => {
  const payload = await verifyHeaderCookie(req)
  if (!payload) {
    return privateJson('用户未登录')
  }

  const limited = await checkPatchSubmissionRateLimit('autosave', payload.uid)
  if (limited) {
    return privateJson(limited)
  }

  const input = await kunParsePutBody(req, patchSubmissionUpdateSchema)
  if (typeof input === 'string') {
    return privateJson(input)
  }

  const result = await updatePatchSubmissionDraft({
    submissionId: input.submissionId,
    userId: payload.uid,
    revision: input.revision,
    payload: input.payload,
    externalSource: input.externalSource,
    externalFetchedAt: input.externalFetchedAt
  })

  return privateJson(result)
}
