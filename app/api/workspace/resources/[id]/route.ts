import type { NextRequest } from 'next/server'
import { workspaceResourceUpdateSchema } from '~/validations/workspace'
import { ResourceMutationError } from '~/app/api/patch/resource/mutation'
import { WORKSPACE_ERRORS } from '~/constants/workspace'
import { workspaceRequest, workspaceBody } from '../../http'
import {
  getWorkspaceResource,
  updateWorkspaceResource,
  deleteWorkspaceResource
} from '../service'

type Context = { params: Promise<{ id: string }> }
const resourceId = async (context: Context) => {
  const { id } = await context.params
  if (
    !/^[1-9]\d*$/.test(id) ||
    !Number.isSafeInteger(Number(id)) ||
    Number(id) > 2147483647
  )
    throw new ResourceMutationError(
      WORKSPACE_ERRORS.invalid_request.message,
      400
    )
  return Number(id)
}
export const GET = (req: NextRequest, context: Context) =>
  workspaceRequest(req, async (user) =>
    getWorkspaceResource(await resourceId(context), user)
  )
export const PUT = (req: NextRequest, context: Context) =>
  workspaceRequest(
    req,
    async (user) =>
      updateWorkspaceResource(
        await resourceId(context),
        await workspaceBody(req, workspaceResourceUpdateSchema),
        user
      ),
    true
  )
export const DELETE = (req: NextRequest, context: Context) =>
  workspaceRequest(
    req,
    async (user) => deleteWorkspaceResource(await resourceId(context), user),
    true
  )
