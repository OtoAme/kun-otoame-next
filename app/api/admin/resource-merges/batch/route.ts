import { NextRequest } from 'next/server'
import { kunParsePostBody } from '~/app/api/utils/parseQuery'
import { withMirrorAdmin } from '~/lib/officialMirror/http'
import { mergeStaffBatch } from '~/lib/officialMirror/mergeService'
import { mergeBatchSchema } from '~/validations/officialMirror'

export const POST = async (req: NextRequest) =>
  withMirrorAdmin(req, async (actorId) => {
    const input = await kunParsePostBody(req, mergeBatchSchema)
    if (typeof input === 'string') return input
    return mergeStaffBatch(input, actorId)
  })
