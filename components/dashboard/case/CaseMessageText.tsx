'use client'

import { Fragment } from 'react'

import { caseTextSegments } from '~/components/case/caseDisplay'

/**
 * Case dialogue text, shared by the dashboard and /issue. It stays plain
 * text; only the three guide paths (D12) become links, opened in a new tab
 * so the reader keeps the case (review item 20).
 */
export function CaseMessageText({ text }: { text: string }) {
  return (
    <>
      {caseTextSegments(text).map((segment, index) =>
        segment.type === 'guide' ? (
          <a
            key={index}
            href={segment.href}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline underline-offset-4"
          >
            {segment.text}
          </a>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        )
      )}
    </>
  )
}
