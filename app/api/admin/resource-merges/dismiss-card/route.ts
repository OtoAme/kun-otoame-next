import { NextRequest } from 'next/server'
import { kunParsePostBody } from '~/app/api/utils/parseQuery'
import { withMirrorAdmin } from '~/lib/officialMirror/http'
import { dismissMergeCard } from '~/lib/officialMirror/mergeService'
import { mergeDismissCardSchema } from '~/validations/officialMirror'

export const POST = async (req: NextRequest) =>
  withMirrorAdmin(req, async (actorId) => {
    const input = await kunParsePostBody(req, mergeDismissCardSchema)
    if (typeof input === 'string') return input
    return dismissMergeCard(input, actorId)
  })
