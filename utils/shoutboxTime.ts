export const isShoutboxEffective = (
  effectiveFrom: Date | null,
  effectiveTo: Date | null,
  now: Date
) =>
  effectiveFrom !== null &&
  effectiveTo !== null &&
  effectiveFrom.getTime() <= now.getTime() &&
  now.getTime() < effectiveTo.getTime()
