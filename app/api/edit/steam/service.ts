import { fetchSteamAppData } from '~/lib/arnebiae/steam'
import type { SteamDetailsResponse } from '~/types/api/externalCompanyData'

export const fetchSteamDetailsData = async (
  steamId: string
): Promise<SteamDetailsResponse> => {
  const data = await fetchSteamAppData(Number(steamId))
  return {
    name: data.name,
    aliases: data.aliases,
    releaseDate: data.releaseDate,
    tags: data.tags,
    developers: data.developers
  }
}
