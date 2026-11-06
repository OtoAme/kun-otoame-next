import { NextRequest } from 'next/server'
import { kunParsePostBody } from '~/app/api/utils/parseQuery'
import { refreshAfterCommit } from '~/lib/officialMirror/cache'
import { withMirrorAdmin } from '~/lib/officialMirror/http'
import { officialMirrorCacheRefreshSchema } from '~/validations/officialMirror'

export const POST = async (req: NextRequest) =>
  withMirrorAdmin(req, async () => {
    const input = await kunParsePostBody(req, officialMirrorCacheRefreshSchema)
    if (typeof input === 'string') return input
    const cacheRefreshed = await refreshAfterCommit('backup-refresh-cache', input)
    return { ...input, cacheRefreshed }
  })
