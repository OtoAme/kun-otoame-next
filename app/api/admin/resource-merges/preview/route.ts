import { NextRequest } from 'next/server'
import { kunParseGetQuery } from '~/app/api/utils/parseQuery'
import { withMirrorAdmin } from '~/lib/officialMirror/http'
import { previewResourceMerge } from '~/lib/officialMirror/mergeService'
import { mergePreviewSchema } from '~/validations/officialMirror'

export const GET = async (req: NextRequest) =>
  withMirrorAdmin(req, async () => {
    const input = kunParseGetQuery(req, mergePreviewSchema)
    if (typeof input === 'string') return input
    return previewResourceMerge(input)
  })
