import { kunFetchPost } from '~/utils/kunFetch'
import type {
  PatchResource,
  PatchResourceAccessResponse
} from '~/types/api/patch'

type AccessFetcher = <T>(
  url: string,
  body?: Record<string, unknown>
) => Promise<T>

export const accessResourceLinksForEdit = async (
  resource: PatchResource,
  fetcher: AccessFetcher = kunFetchPost
): Promise<PatchResource | string> => {
  const hydratedLinks: PatchResource['links'] = []

  for (const link of resource.links) {
    const response = await fetcher<PatchResourceAccessResponse | string>(
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

    hydratedLinks.push({
      ...link,
      ...response.link
    })
  }

  return {
    ...resource,
    links: hydratedLinks
  }
}
