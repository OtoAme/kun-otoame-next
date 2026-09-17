import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { config as loadDotenv } from 'dotenv'

import {
  createNextmoeCatalogClient,
  type NextmoeCatalogClient
} from '~/app/api/company/nextmoe/client'

const SAMPLE_WORK_REFS = ['vndb:v2168', 'bangumi:21041']
const SAMPLE_COMPANY_REFS = ['vndb:p473']
const SAMPLE_COMPANY_ID_MAX = 100

export const NEXTMOE_PROBE_SKIPPED_MESSAGE =
  'NextMoe company sample probe skipped: KUN_NEXTMOE_API_KEY is not configured'

export const isNextmoeProbeConfigured = (apiKey: string | null | undefined) =>
  typeof apiKey === 'string' && apiKey.trim().length > 0

export const runNextmoeCompanySampleProbe = async (
  client: NextmoeCatalogClient | null,
  write: (line: string) => void
) => {
  if (!client) {
    write(NEXTMOE_PROBE_SKIPPED_MESSAGE)
    return
  }

  const works = await client.listWorksByRefs(SAMPLE_WORK_REFS)
  const producerCompanies =
    await client.listCompaniesByRefs(SAMPLE_COMPANY_REFS)
  const workCompanyIds = [
    ...new Set(
      works.items.flatMap((work) =>
        (work.companies ?? []).map((company) => company.id.trim())
      )
    )
  ]
    .filter(Boolean)
    .slice(0, SAMPLE_COMPANY_ID_MAX)
  const workCompanies = workCompanyIds.length
    ? await client.listCompaniesByIds(workCompanyIds)
    : null

  write(JSON.stringify({ works, producerCompanies, workCompanies }, null, 2))
}

const shouldRunCli = () => {
  const entry = process.argv[1]
  return Boolean(
    entry && import.meta.url === pathToFileURL(resolve(entry)).href
  )
}

if (shouldRunCli()) {
  loadDotenv()
  const configured = isNextmoeProbeConfigured(process.env.KUN_NEXTMOE_API_KEY)
  const client = configured ? createNextmoeCatalogClient() : null
  void runNextmoeCompanySampleProbe(client, (line) =>
    process.stdout.write(`${line}\n`)
  )
    .then(() => {
      if (!client) process.exit(0)
    })
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
}
