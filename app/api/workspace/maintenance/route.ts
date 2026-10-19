import type { NextRequest } from 'next/server'
import { workspaceRequest, workspaceQuery, workspaceBody } from '../http'
import { workspaceMaintenanceQuerySchema } from '~/validations/workspace'
import { linkMaintenanceActionSchema } from '~/validations/linkMaintenance'
import { getWorkspaceMaintenance } from '~/app/api/patch/resource/maintenance/read'
import { mutateLinkMaintenance } from '~/app/api/patch/resource/maintenance/service'
import { getPatchVisibilityWhere } from '~/app/api/utils/getPatchVisibilityWhere'

export const GET = (req: NextRequest) =>
  workspaceRequest(req, (user) =>
    getWorkspaceMaintenance(
      workspaceQuery(req, workspaceMaintenanceQuerySchema),
      user
    )
  )
export const POST = (req: NextRequest) =>
  workspaceRequest(
    req,
    async (user) =>
      mutateLinkMaintenance(
        await workspaceBody(req, linkMaintenanceActionSchema),
        { uid: user.id, role: user.role },
        await getPatchVisibilityWhere(req)
      ),
    true
  )
