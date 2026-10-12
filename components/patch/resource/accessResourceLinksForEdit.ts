import { kunFetchPost } from '~/utils/kunFetch'
import { LINK_HEALTH_ERRORS } from '~/constants/linkHealth'
import { readLinkHealth } from './linkHealthDisplay'
import type {
  PatchResource,
  PatchResourceHealthAccessResponse,
  PatchResourceLink
} from '~/types/api/patch'
import type { LinkVersionBase } from '~/types/api/linkHealth'

type AccessFetcher = <T>(
  url: string,
  body?: Record<string, unknown>
) => Promise<T>

/**
 * Edit baseline carried on the resource object through pass-through state. It
 * is captured exactly once at editor open — never recaptured at submit time.
 */
export interface ResourceEditContext {
  /** Complete slot baseline from the single original snapshot (may be empty). */
  baseLinks: LinkVersionBase[]
  /** 补链 entry: the dialog focuses this link's address field. */
  focusLinkId?: number
}

const EDIT_CONTEXT_KEY = '__resourceEditContext'

type EditContextCarrier = { [EDIT_CONTEXT_KEY]?: ResourceEditContext }

export const withEditContext = (
  resource: PatchResource,
  context: ResourceEditContext
): PatchResource => {
  ;(resource as EditContextCarrier)[EDIT_CONTEXT_KEY] = context
  return resource
}

export const readEditContext = (
  resource: PatchResource
): ResourceEditContext | null =>
  (resource as EditContextCarrier)[EDIT_CONTEXT_KEY] ?? null

export const STALE_EDIT_BASE_ERROR = LINK_HEALTH_ERRORS.version_conflict.message
export const MISSING_EDIT_BASE_ERROR =
  LINK_HEALTH_ERRORS.resource_conflict.message

/** Domain versions from a single snapshot; null when the read is not the stable reader. */
const snapshotBaseFromLinks = (
  links: readonly PatchResourceLink[]
): LinkVersionBase[] | null => {
  const base: LinkVersionBase[] = []
  for (const link of links) {
    const version = readLinkHealth(link)?.version
    if (typeof version !== 'number') {
      return null
    }
    base.push({ id: link.id, version })
  }
  return base
}

/**
 * The one immutable baseline captured at editor open. Priority: a complete
 * `baseLinks` array already supplied by an authorized admin DTO; otherwise the
 * version set of the link snapshot itself. An explicit EMPTY snapshot (zero
 * links) is a legitimate baseline (the form's one-link floor still applies);
 * a snapshot with any unversioned link yields null — callers must fail closed
 * with refresh guidance instead of submitting without a baseline.
 */
export const captureResourceEditContext = (
  resource: PatchResource,
  focusLinkId?: number
): ResourceEditContext | null => {
  const dto = (resource as { baseLinks?: LinkVersionBase[] }).baseLinks
  let baseLinks: LinkVersionBase[] | null = null
  if (Array.isArray(dto)) {
    baseLinks = dto
  } else {
    baseLinks = snapshotBaseFromLinks(resource.links)
  }
  if (baseLinks === null) {
    return null
  }
  return focusLinkId === undefined ? { baseLinks } : { baseLinks, focusLinkId }
}

/**
 * Site editor hydration: capture the baseline from the open snapshot FIRST,
 * then verify every sequential access response reports the same version.
 * Any mismatch (or a snapshot without versions) rejects the whole open —
 * an edit is never prepared from a mixed or missing baseline.
 */
export const accessResourceLinksForEdit = async (
  resource: PatchResource,
  fetcher: AccessFetcher = kunFetchPost,
  focusLinkId?: number
): Promise<PatchResource | string> => {
  const context = captureResourceEditContext(resource, focusLinkId)
  if (!context) {
    return MISSING_EDIT_BASE_ERROR
  }
  const expectedVersionBySlot = new Map(
    context.baseLinks.map((base) => [base.id, base.version])
  )

  const hydratedLinks: PatchResource['links'] = []
  for (const link of resource.links) {
    const response = await fetcher<PatchResourceHealthAccessResponse | string>(
      '/patch/resource/download/access',
      {
        patchId: resource.patchId,
        resourceId: resource.id,
        linkId: link.id
      }
    )
    if (typeof response === 'string') {
      return response
    }

    if (response.link.version !== expectedVersionBySlot.get(link.id)) {
      return STALE_EDIT_BASE_ERROR
    }
    hydratedLinks.push({ ...link, ...response.link })
  }

  return withEditContext({ ...resource, links: hydratedLinks }, context)
}
