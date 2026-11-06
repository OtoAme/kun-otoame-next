import { NextRequest } from 'next/server'
import { kunParseGetQuery } from '~/app/api/utils/parseQuery'
import { withMirrorAdmin } from '~/lib/officialMirror/http'
import { listBackupQueue } from '~/lib/officialMirror/backupService'
import { backupListSchema } from '~/validations/officialMirror'

export const GET = async (req: NextRequest) =>
  withMirrorAdmin(req, async () => {
    const input = kunParseGetQuery(req, backupListSchema)
    if (typeof input === 'string') return input
    return listBackupQueue(input)
  })
