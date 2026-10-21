import type {
  WORKSPACE_ENTRY_VIEWS,
  WORKSPACE_MAINTENANCE_VIEWS,
  WORKSPACE_RESOURCE_STATUSES,
  WORKSPACE_SECTIONS
} from '~/constants/workspace'
import type { LinkVersionBase } from './linkHealth'
import type { ResourceDiskKind } from '~/utils/resourceDiskKind'
import type { LinkMaintenanceItem } from './linkMaintenance'
import type { MoemoepointBalance } from './moemoepoint'
import type {
  PatchResourceHealthAccessLink,
  PatchResourceStableUpdateRequest
} from './patch'
import type {
  PatchSubmissionQuota,
  PatchSubmissionStatus,
  PatchSubmissionSummary
} from './patchSubmission'

export interface WorkspaceUser {
  id: number
  name: string
  role: number
}
export interface WorkspacePagination {
  page: number
  limit: number
}
export type WorkspaceEntryView = (typeof WORKSPACE_ENTRY_VIEWS)[number]
export type WorkspaceMaintenanceView =
  (typeof WORKSPACE_MAINTENANCE_VIEWS)[number]
export type WorkspaceResourceStatus =
  (typeof WORKSPACE_RESOURCE_STATUSES)[number]
export type WorkspaceSection = (typeof WORKSPACE_SECTIONS)[number]

export interface WorkspaceEntriesQuery extends WorkspacePagination {
  view: WorkspaceEntryView
  query?: string
  status?: PatchSubmissionStatus | 'all'
}
export interface WorkspaceResourcesQuery extends WorkspacePagination {
  query?: string
  status: WorkspaceResourceStatus
  section: WorkspaceSection
}
export interface WorkspaceMaintenanceQuery extends WorkspacePagination {
  view: WorkspaceMaintenanceView
  query?: string
  section: WorkspaceSection
}

export type WorkspaceEntry =
  | { kind: 'submission'; submission: PatchSubmissionSummary }
  | {
      kind: 'published'
      patch: {
        id: number
        uniqueId: string
        name: string
        banner: string
        status: number
        created: string
      }
    }

export interface WorkspaceEntriesResponse extends WorkspacePagination {
  items: WorkspaceEntry[]
  total: number
  quota: PatchSubmissionQuota | null
  moemoepointBalance: MoemoepointBalance
  canCreateDirect: boolean
}

export interface WorkspaceResourceSummary {
  id: number
  patchId: number
  patchUniqueId: string
  patchName: string
  patchBanner: string
  name: string
  section: string
  type: string[]
  language: string[]
  platform: string[]
  status: number
  created: string
  linkCount: number
  /** Netdisk or storage kind of each link, in link order, without duplicates. */
  linkDiskKinds: ResourceDiskKind[]
  actionableCount: number
  capabilities: { canEdit: boolean; canDelete: boolean; canUpload: boolean }
}

export interface WorkspaceResourcesResponse extends WorkspacePagination {
  items: WorkspaceResourceSummary[]
  total: number
}

/** Protected slots expose exactly these four fields, including on read-only resources. */
export interface WorkspaceProtectedLink extends LinkVersionBase {
  storage: string
  protected: true
}
export interface WorkspaceEditableLink extends PatchResourceHealthAccessLink {
  protected: false
}
export interface WorkspaceResourceDetail extends WorkspaceResourceSummary {
  note: string
  baseLinks: LinkVersionBase[]
  links: (WorkspaceProtectedLink | WorkspaceEditableLink)[]
  maintenance: LinkMaintenanceItem[]
}

/** The strict retention branch has only id/version, without a discriminator. */
export type WorkspaceResourceLinkInput =
  | LinkVersionBase
  | PatchResourceStableUpdateRequest['links'][number]

export type WorkspaceResourceUpdateInput = Pick<
  PatchResourceStableUpdateRequest,
  'name' | 'section' | 'note' | 'type' | 'language' | 'platform' | 'baseLinks'
> & { links: WorkspaceResourceLinkInput[] }

export interface WorkspaceResourceDeleteResponse {
  deleted: true
  moemoepointBalance?: MoemoepointBalance
}
