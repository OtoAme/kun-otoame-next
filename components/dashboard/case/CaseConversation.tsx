'use client'

import { formatChinaDateTime } from '~/utils/fixedTimezoneDate'
import {
  caseMessageAuthorLabel,
  caseSystemEventText
} from '~/components/case/caseDisplay'
import type { CaseMessage } from '~/types/api/case'

interface CaseConversationProps {
  messages: CaseMessage[]
  /**
   * Whether this viewer is one the server identifies reporters to. It decides
   * what a null author means: for a viewer who never sees reporter identity it
   * is an anonymized reporter, for an admin it can only be a deleted account.
   * Defaults to the safe reading, so a non-admin reuse cannot mislabel anyone.
   */
  identifiesReporter?: boolean
}

/**
 * Conversation timeline. Replies and system events share one chronological
 * rail but are deliberately not styled alike: a reply is somebody's text that
 * can be answered, a system event is a state change nobody wrote.
 */
export function CaseConversation({
  messages,
  identifiesReporter = false
}: CaseConversationProps) {
  if (messages.length === 0) {
    return (
      <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
        这条事项还没有往来记录
      </p>
    )
  }

  return (
    <ol className="relative space-y-3 border-l pl-5">
      {messages.map((message) =>
        message.kind === 'system' ? (
          <li key={message.id} className="relative">
            <span
              className="absolute top-1.5 -left-6 size-2 rounded-full border bg-background"
              aria-hidden
            />
            <p className="text-xs text-muted-foreground">
              {caseSystemEventText(message)}
              <span className="ml-2 tabular-nums">
                {formatChinaDateTime(message.created)}
              </span>
            </p>
          </li>
        ) : (
          <li key={message.id} className="relative">
            <span
              className="absolute top-2.5 -left-6 size-2 rounded-full bg-primary"
              aria-hidden
            />
            <div className="min-w-0 rounded-md border bg-card p-3">
              <div className="mb-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {caseMessageAuthorLabel(message, identifiesReporter)}
                </span>
                <span className="tabular-nums">
                  {formatChinaDateTime(message.created)}
                </span>
              </div>
              <p className="whitespace-pre-wrap break-words text-sm">
                {message.body}
              </p>
            </div>
          </li>
        )
      )}
    </ol>
  )
}
