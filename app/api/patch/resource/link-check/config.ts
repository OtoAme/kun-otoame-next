/** Trusted server composition only; no client-supplied endpoints or keys. */
export const getLinkCheckerConfig = () => ({
  endpoint: process.env.KUN_LINK_CHECKER_ENDPOINT ?? '',
  apiKey: process.env.KUN_LINK_CHECKER_API_KEY ?? ''
})
