import { NextRequest } from 'next/server'
import { kunParsePostBody } from '~/app/api/utils/parseQuery'
import { withMirrorAdmin } from '~/lib/officialMirror/http'
import { reopenResourceMerge } from '~/lib/officialMirror/mergeService'
import { mergePairSchema } from '~/validations/officialMirror'

export const POST = async (req: NextRequest) =>
  withMirrorAdmin(req, async (actorId) => {
    const input = await kunParsePostBody(req, mergePairSchema)
    if (typeof input === 'string') return input
    return reopenResourceMerge(input, actorId)
  })
