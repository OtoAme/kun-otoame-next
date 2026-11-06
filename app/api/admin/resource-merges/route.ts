import { NextRequest } from 'next/server'
import { kunParseGetQuery } from '~/app/api/utils/parseQuery'
import { withMirrorAdmin } from '~/lib/officialMirror/http'
import { listResourceMerges } from '~/lib/officialMirror/mergeService'
import { mergeListSchema } from '~/validations/officialMirror'

export const GET = async (req: NextRequest) =>
  withMirrorAdmin(req, async () => {
    const input = kunParseGetQuery(req, mergeListSchema)
    if (typeof input === 'string') return input
    return listResourceMerges(input)
  })
