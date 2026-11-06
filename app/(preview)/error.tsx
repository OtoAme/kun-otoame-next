'use client'

import { ErrorComponent } from '~/components/error/ErrorComponent'

export default function PreviewError({
  error,
  reset
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <ErrorComponent showReset={true} error={error.message} reset={reset} />
}
