import { Prisma } from '@prisma/client'
import {
  resolveMergedResource,
  type ResolveReader
} from '~/lib/officialMirror/resolve'
import type { HelpPatchLink } from '~/types/api/help'

type PatchRow = { id: number; unique_id: string; name: string }

type PresetDb = ResolveReader & {
  patch: {
    findFirst: (args: {
      where: Prisma.patchWhereInput
      select: { id: true; unique_id: true; name: true }
    }) => Promise<PatchRow | null>
  }
  patch_resource: ResolveReader['patch_resource'] & {
    findUnique: (args: {
      where: { id: number }
      select: { status: true; patch_id: true }
    }) => Promise<{ status: number; patch_id: number } | null>
  }
}

const toLink = (patch: PatchRow): HelpPatchLink => ({
  id: patch.id,
  uniqueId: patch.unique_id,
  name: patch.name
})

/**
 * `?patch=&resource=` only suggests a link. A missing card is one hop through
 * the existing merge mapping. The survivor is checked with the caller's
 * patch visibility and must be a public card on a public game. A card that
 * moved to another game prefills that current game.
 */
export const resolveHelpCreatePreset = async (
  db: PresetDb,
  input: {
    patchUniqueId: string
    resourceRaw: string
    visibilityWhere: Prisma.patchWhereInput
  }
) => {
  const patchUniqueId = /^[A-Za-z0-9]{8}$/.test(input.patchUniqueId)
    ? input.patchUniqueId
    : ''
  const parsed = Number(input.resourceRaw)
  const resourceId =
    input.resourceRaw !== '' && Number.isSafeInteger(parsed) && parsed > 0
      ? parsed
      : null
  const loadPatch = (where: Prisma.patchWhereInput) =>
    db.patch.findFirst({
      where: { ...input.visibilityWhere, ...where, status: 0 },
      select: { id: true, unique_id: true, name: true }
    })

  let presetPatch: HelpPatchLink | null = null
  if (patchUniqueId) {
    const patch = await loadPatch({ unique_id: patchUniqueId })
    if (patch) presetPatch = toLink(patch)
  }
  if (resourceId === null) return { presetPatch, presetResourceId: null }

  const resource = await db.patch_resource.findUnique({
    where: { id: resourceId },
    select: { status: true, patch_id: true }
  })
  if (resource) {
    const sameGame =
      resource.status === 0 &&
      presetPatch !== null &&
      resource.patch_id === presetPatch.id
    return {
      presetPatch,
      presetResourceId: sameGame ? resourceId : null
    }
  }

  const hit = await resolveMergedResource(db, resourceId, input.visibilityWhere)
  if (!hit) return { presetPatch, presetResourceId: null }
  if (presetPatch?.id === hit.patchId) {
    return { presetPatch, presetResourceId: hit.resourceId }
  }
  const current = await loadPatch({ id: hit.patchId })
  if (!current || current.unique_id !== hit.patchUniqueId) {
    return { presetPatch, presetResourceId: null }
  }
  return { presetPatch: toLink(current), presetResourceId: hit.resourceId }
}
