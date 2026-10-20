import type { Prisma } from '@prisma/client'
import { prisma } from '~/prisma/index'
import { WORKSPACE_ERRORS } from '~/constants/workspace'
import { ResourceMutationError } from '~/app/api/patch/resource/mutation'
import {
  linkHealthSelect,
  projectLinkHealth,
  getLinkDisputeSources
} from '~/app/api/patch/resource/linkHealthProjection'
import { updateWorkspacePatchResource } from '~/app/api/patch/resource/update'
import { deleteResource } from '~/app/api/patch/resource/delete'
import {
  getMaintenanceItem,
  resourceActionableMaintenanceCounts
} from '~/app/api/patch/resource/maintenance/read'
import type {
  WorkspaceUser,
  WorkspaceResourcesQuery,
  WorkspaceResourcesResponse,
  WorkspaceResourceDetail,
  WorkspaceResourceSummary,
  WorkspaceResourceUpdateInput,
  WorkspaceResourceDeleteResponse
} from '~/types/api/workspace'

const resourceSelect = {
  id: true,
  patch_id: true,
  user_id: true,
  name: true,
  section: true,
  type: true,
  language: true,
  platform: true,
  status: true,
  created: true,
  patch: { select: { name: true, unique_id: true, banner: true } },
  links: { select: { storage: true } }
} satisfies Prisma.patch_resourceSelect
type SummaryRow = Prisma.patch_resourceGetPayload<{
  select: typeof resourceSelect
}>
const summary = (
  row: SummaryRow,
  user: WorkspaceUser
): WorkspaceResourceSummary => ({
  id: row.id,
  patchId: row.patch_id,
  patchUniqueId: row.patch.unique_id,
  patchName: row.patch.name,
  patchBanner: row.patch.banner,
  name: row.name,
  section: row.section,
  type: row.type,
  language: row.language,
  platform: row.platform,
  status: row.status,
  created: row.created.toISOString(),
  linkCount: row.links.length,
  actionableCount: 0,
  capabilities: {
    canEdit: user.role >= 3 || row.status === 0,
    canDelete:
      user.role >= 3 || row.links.every((link) => link.storage !== 'touchgal'),
    canUpload:
      (user.role >= 3 || row.status === 0) &&
      user.role >= 2 &&
      (row.section !== 'galgame' || user.role >= 3)
  }
})
export const getWorkspaceResources = async (
  input: WorkspaceResourcesQuery,
  user: WorkspaceUser
): Promise<WorkspaceResourcesResponse> => {
  const status = { normal: 0, banned: 1, pending: 2 }
  const where: Prisma.patch_resourceWhereInput = {
    user_id: user.id,
    ...(input.status !== 'all' ? { status: status[input.status] } : {}),
    ...(input.section !== 'all' ? { section: input.section } : {}),
    ...(input.query
      ? {
          OR: [
            { name: { contains: input.query, mode: 'insensitive' } },
            { patch: { name: { contains: input.query, mode: 'insensitive' } } }
          ]
        }
      : {})
  }
  const [rows, total] = await Promise.all([
    prisma.patch_resource.findMany({
      where,
      select: resourceSelect,
      orderBy: [{ created: 'desc' }, { id: 'desc' }],
      skip: (input.page - 1) * input.limit,
      take: input.limit
    }),
    prisma.patch_resource.count({ where })
  ])
  const counts = await resourceActionableMaintenanceCounts(
    user,
    rows.map((row) => row.id)
  )
  return {
    items: rows.map((row) => ({
      ...summary(row, user),
      actionableCount: counts.get(row.id) ?? 0
    })),
    total,
    page: input.page,
    limit: input.limit
  }
}
export const getWorkspaceResource = async (
  id: number,
  user: WorkspaceUser
): Promise<WorkspaceResourceDetail> => {
  const now = new Date()
  const row = await prisma.patch_resource.findFirst({
    where: { id, user_id: user.id },
    include: {
      patch: { select: { name: true, unique_id: true, banner: true } },
      links: {
        select: linkHealthSelect(now),
        orderBy: [{ sort_order: 'asc' }, { id: 'asc' }]
      }
    }
  })
  if (!row)
    throw new ResourceMutationError(WORKSPACE_ERRORS.not_found.message, 404)
  const base = summary(row, user)
  const counts = await resourceActionableMaintenanceCounts(user, [row.id])
  base.actionableCount = counts.get(row.id) ?? 0
  const disputes = await getLinkDisputeSources(
    row.links.map((link) => ({
      ...link,
      resourceId: id,
      patchId: row.patch_id
    }))
  )
  return {
    ...base,
    note: row.note,
    baseLinks: row.links.map((link) => ({
      id: link.id,
      version: link.version
    })),
    links: row.links.map((link) =>
      !base.capabilities.canEdit ||
      (user.role < 3 && link.storage === 'touchgal')
        ? {
            id: link.id,
            version: link.version,
            storage: link.storage,
            protected: true
          }
        : {
            ...projectLinkHealth(
              link,
              user.id,
              { uid: user.id, role: user.role },
              disputes.get(link.id) ?? null,
              now
            ),
            id: link.id,
            storage: link.storage,
            size: link.size,
            hash: link.hash,
            sortOrder: link.sort_order,
            download: link.download,
            content: link.content,
            code: link.code,
            password: link.password,
            protected: false
          }
    ),
    maintenance:
      row.status === 0
        ? await Promise.all(
            row.links
              .filter(
                (link) =>
                  (user.role >= 3 || link.storage !== 'touchgal') &&
                  (link.health !== 'ok' ||
                    link.maintenance_controls.some(
                      (control) => control.link_version === link.version
                    ))
              )
              .map((link) =>
                getMaintenanceItem(
                  {
                    patchId: row.patch_id,
                    resourceId: row.id,
                    linkId: link.id,
                    linkVersion: link.version
                  },
                  user,
                  prisma,
                  now
                )
              )
          )
        : []
  }
}
export const updateWorkspaceResource = (
  id: number,
  input: WorkspaceResourceUpdateInput,
  user: WorkspaceUser
) => updateWorkspacePatchResource(id, input, user.id, user.role)

export const deleteWorkspaceResource = async (
  id: number,
  user: WorkspaceUser
): Promise<WorkspaceResourceDeleteResponse | string> => {
  const row = await prisma.patch_resource.findFirst({
    where: { id, user_id: user.id },
    select: { id: true }
  })
  if (!row)
    throw new ResourceMutationError(WORKSPACE_ERRORS.not_found.message, 404)
  const result = await deleteResource({ resourceId: id }, user.id, user.role, {
    expectedOwnerId: user.id
  })
  if (typeof result === 'string') return result
  return { deleted: true, moemoepointBalance: result.moemoepointBalance }
}
