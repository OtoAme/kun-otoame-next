import { NextRequest } from 'next/server'
import { kunParseGetQuery } from '~/app/api/utils/parseQuery'
import { withMirrorAdmin } from '~/lib/officialMirror/http'
import { getMergeOptions } from '~/lib/officialMirror/mergeService'
import { mergeOptionsSchema } from '~/validations/officialMirror'

export const GET = async (req: NextRequest) =>
  withMirrorAdmin(req, async () => {
    const input = kunParseGetQuery(req, mergeOptionsSchema)
    if (typeof input === 'string') return input
    return getMergeOptions(input)
  })
