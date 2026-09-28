'use client'

import { EyeOff, Eye } from 'lucide-react'

import { Badge } from '~/components/dashboard/ui/badge'
import { Button } from '~/components/dashboard/ui/button'
import { formatChinaDateTime } from '~/utils/fixedTimezoneDate'
import {
  caseMessageAuthorLabel,
  caseSystemEventText
} from '~/components/case/caseDisplay'
import type { CaseMessage } from '~/types/api/case'

import { CaseMessageText } from './CaseMessageText'

interface CaseConversationProps {
  messages: CaseMessage[]
  /**
   * Whether this viewer is one the server identifies reporters to. It decides
   * what a null author means: for a viewer who never sees reporter identity it
   * is an anonymized reporter, for an admin it can only be a deleted account.
   * Defaults to the safe reading, so a non-admin reuse cannot mislabel anyone.
   */
  identifiesReporter?: boolean
  /**
   * Offered only when the server grants `canHideMessages` (D27). The caller
   * confirms before writing; the trigger lets focus return to the button.
   */
  onToggleHidden?: (message: CaseMessage, trigger: HTMLButtonElement) => void
  actionsDisabled?: boolean
}

/**
 * Conversation timeline. Replies and system events share one chronological
 * rail but are deliberately not styled alike: a reply is somebody's text that
 * can be answered, a system event is a state change nobody wrote.
 */
export function CaseConversation({
  messages,
  identifiesReporter = false,
  onToggleHidden,
  actionsDisabled = false
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
            <p className="text-xs whitespace-pre-wrap break-words text-muted-foreground">
              <CaseMessageText text={caseSystemEventText(message)} />
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
            <div
              className={
                message.hidden
                  ? 'min-w-0 rounded-md border border-dashed bg-muted/40 p-3'
                  : 'min-w-0 rounded-md border bg-card p-3'
              }
            >
              <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {caseMessageAuthorLabel(message, identifiesReporter)}
                </span>
                {/* A later reporter's note saved on this case (D15). */}
                {message.kind === 'report' ? <span>其他报告者</span> : null}
                <span className="tabular-nums">
                  {formatChinaDateTime(message.created)}
                </span>
                {message.hidden ? (
                  <Badge variant="outline">已隐藏，仅网站管理员可见</Badge>
                ) : null}
                {onToggleHidden ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-6 px-2 text-xs"
                    disabled={actionsDisabled}
                    onClick={(event) =>
                      onToggleHidden(message, event.currentTarget)
                    }
                  >
                    {message.hidden ? (
                      <Eye className="size-3.5" aria-hidden />
                    ) : (
                      <EyeOff className="size-3.5" aria-hidden />
                    )}
                    {message.hidden ? '取消隐藏' : '隐藏'}
                  </Button>
                ) : null}
              </div>
              <p className="whitespace-pre-wrap break-words text-sm">
                <CaseMessageText text={message.body} />
              </p>
              {message.images?.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {message.images.map((url, index) => (
                    <a key={url} href={url} target="_blank" rel="noreferrer">
                      <img
                        src={url}
                        alt={`附图 ${index + 1}`}
                        loading="lazy"
                        className="size-20 rounded-md border object-cover"
                      />
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
          </li>
        )
      )}
    </ol>
  )
}
