import type { NextRequest } from 'next/server'
import { workspaceEntriesQuerySchema } from '~/validations/workspace'
import { workspaceRequest, workspaceQuery } from '../http'
import { getWorkspaceEntries } from './service'

export const GET = (req: NextRequest) =>
  workspaceRequest(req, (user) =>
    getWorkspaceEntries(workspaceQuery(req, workspaceEntriesQuerySchema), user)
  )
