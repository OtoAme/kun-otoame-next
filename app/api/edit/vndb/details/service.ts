import { fetchVndbVn } from '~/lib/arnebiae/vndb'
import type { VNDBDetailResult } from '~/lib/arnebiae/vndb'
import type {
  VndbCompanyProducer,
  VndbDetailsResponse
} from '~/types/api/externalCompanyData'

interface VNDBFullResult extends VNDBDetailResult {
  developers?: VndbCompanyProducer[] | null
}

const buildAllTitles = (response: { results: VNDBFullResult[] }) =>
  response.results.flatMap((vn) => {
    const jaTitle = vn.titles.find((title) => title.lang === 'ja')?.title
    return [
      ...(jaTitle ? [jaTitle] : []),
      vn.title,
      ...vn.titles
        .filter((title) => title.lang !== 'ja')
        .map((title) => title.title),
      ...vn.aliases
    ]
  })

const isSupportedProducer = (producer: VndbCompanyProducer) =>
  Boolean(
    producer.name &&
      (producer.type === 'co' ||
        producer.type === 'ng' ||
        producer.type === 'in')
  )

export const fetchVndbDetailsData = async (
  vndbId: string
): Promise<VndbDetailsResponse> => {
  const normalizedId = vndbId.trim().toLowerCase()
  const data = await fetchVndbVn<VNDBFullResult>(
    ['id', '=', normalizedId],
    'title, titles.lang, titles.title, aliases, released, developers{id,name,original,aliases,lang,type,description,extlinks{url}}'
  )
  if (!data.results.length) {
    throw new Error('VNDB_NOT_FOUND')
  }

  const producers = data.results
    .flatMap((vn) => vn.developers ?? [])
    .filter(isSupportedProducer)
  const developers = [
    ...new Set(
      producers
        .map((producer) => producer.name?.trim())
        .filter((name): name is string => Boolean(name))
    )
  ]

  return {
    titles: buildAllTitles(data),
    released: data.results[0].released,
    tags: [],
    developers,
    producers
  }
}
