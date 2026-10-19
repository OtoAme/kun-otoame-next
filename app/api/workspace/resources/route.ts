import type { NextRequest } from 'next/server'
import { workspaceResourcesQuerySchema } from '~/validations/workspace'
import { workspaceRequest, workspaceQuery } from '../http'
import { getWorkspaceResources } from './service'

export const GET = (req: NextRequest) =>
  workspaceRequest(req, (user) =>
    getWorkspaceResources(
      workspaceQuery(req, workspaceResourcesQuerySchema),
      user
    )
  )
