import { NextRequest } from 'next/server'
import { kunParsePostBody } from '~/app/api/utils/parseQuery'
import { unignoreBackup } from '~/lib/officialMirror/backupService'
import { withMirrorAdmin } from '~/lib/officialMirror/http'
import { backupResourceSchema } from '~/validations/officialMirror'

export const POST = async (req: NextRequest) =>
  withMirrorAdmin(req, async (actorId) => {
    const input = await kunParsePostBody(req, backupResourceSchema)
    if (typeof input === 'string') return input
    return unignoreBackup(input, actorId)
  })
