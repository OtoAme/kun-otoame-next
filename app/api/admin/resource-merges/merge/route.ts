import { NextRequest } from 'next/server'
import { kunParsePostBody } from '~/app/api/utils/parseQuery'
import { withMirrorAdmin } from '~/lib/officialMirror/http'
import { mergeStaffIntoUser } from '~/lib/officialMirror/mergeService'
import { mergeExecuteSchema } from '~/validations/officialMirror'

export const POST = async (req: NextRequest) =>
  withMirrorAdmin(req, async (actorId) => {
    const input = await kunParsePostBody(req, mergeExecuteSchema)
    if (typeof input === 'string') return input
    return mergeStaffIntoUser(input, actorId)
  })
