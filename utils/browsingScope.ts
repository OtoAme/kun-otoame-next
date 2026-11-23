export const getBrowsingKey = (mode: string, blockedTagIds: number[]) =>
  JSON.stringify([
    mode,
    [...blockedTagIds].sort((first, second) => first - second)
  ])
