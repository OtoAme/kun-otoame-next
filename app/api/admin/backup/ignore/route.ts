import { NextRequest } from 'next/server'
import { kunParsePostBody } from '~/app/api/utils/parseQuery'
import { ignoreBackup } from '~/lib/officialMirror/backupService'
import { withMirrorAdmin } from '~/lib/officialMirror/http'
import { backupIgnoreSchema } from '~/validations/officialMirror'

export const POST = async (req: NextRequest) =>
  withMirrorAdmin(req, async (actorId) => {
    const input = await kunParsePostBody(req, backupIgnoreSchema)
    if (typeof input === 'string') return input
    return ignoreBackup(input, actorId)
  })
