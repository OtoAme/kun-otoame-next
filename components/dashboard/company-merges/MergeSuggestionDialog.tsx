'use client'

import { useId, useMemo, useRef, useState, type RefObject } from 'react'
import toast from 'react-hot-toast'
import { Loader2, Merge } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '~/components/dashboard/ui/alert-dialog'
import { Button } from '~/components/dashboard/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '~/components/dashboard/ui/select'
import { cn } from '~/lib/dashboard/utils'
import { kunFetchPost } from '~/utils/kunFetch'
import type {
  CompanyMergeApplyResponse,
  CompanyMergeParticipant,
  CompanyMergeSuggestion
} from '~/types/api/companyMerges'

interface MergeSuggestionDialogProps {
  suggestion: CompanyMergeSuggestion
  onMerged: (id: number) => void
  /** 合并成功后本行连同触发按钮一起卸载, 焦点退到这里。 */
  fallbackFocusRef: RefObject<HTMLElement | null>
}

interface MergeDraft {
  survivingCompanyId: number
  name: string
  introductionFromCompanyId: number
}

const sortedUnique = (values: string[]) =>
  [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right, 'en')
  )

const participantLabel = (participant: CompanyMergeParticipant) =>
  participant.name === null
    ? `#${participant.companyId}（已不存在）`
    : `${participant.name}（#${participant.companyId}）`

/**
 * 主名候选 = 每家参与会社的名称与别名。服务端按 trim 后完全相等校验, 所以这里的
 * value 就是提交值; 同名值只留第一条, 免得出现两个选中效果相同的选项。
 */
const buildNameOptions = (participants: CompanyMergeParticipant[]) => {
  const options: Array<{ value: string; label: string }> = []
  const seen = new Set<string>()
  for (const participant of participants) {
    if (participant.name === null) continue
    const entries: Array<[string, string]> = [
      [participant.name, '主名'],
      ...participant.aliases.map((alias): [string, string] => [alias, '别名'])
    ]
    for (const [rawValue, kind] of entries) {
      const value = rawValue.trim()
      if (!value || seen.has(value)) continue
      seen.add(value)
      options.push({
        value,
        label: `${value}（#${participant.companyId} ${kind}）`
      })
    }
  }
  return options
}

/** 「存续会社介绍非空就用它, 否则用第一家非空的, 都没有就还是存续会社」。 */
const defaultIntroductionSource = (
  participants: CompanyMergeParticipant[],
  survivingCompanyId: number
) => {
  const surviving = participants.find(
    (participant) => participant.companyId === survivingCompanyId
  )
  if (surviving?.introductionPreview) return survivingCompanyId
  const firstWithIntroduction = participants.find(
    (participant) => participant.introductionPreview
  )
  return firstWithIntroduction?.companyId ?? survivingCompanyId
}

const smallestCompanyId = (companyIds: number[], fallback: number) =>
  companyIds.length ? Math.min(...companyIds) : fallback

const ownerCompanyIdForSelectedName = (
  participants: CompanyMergeParticipant[],
  name: string
) => {
  const selected = name.trim()
  const asMain = participants.filter(
    (participant) => participant.name === selected
  )
  if (asMain.length) {
    return smallestCompanyId(
      asMain.map((participant) => participant.companyId),
      asMain[0].companyId
    )
  }
  const asAlias = participants.filter((participant) =>
    participant.aliases.includes(selected)
  )
  if (asAlias.length) {
    return smallestCompanyId(
      asAlias.map((participant) => participant.companyId),
      asAlias[0].companyId
    )
  }
  return null
}

const buildDraft = (
  suggestion: CompanyMergeSuggestion,
  survivingCompanyId: number
): MergeDraft => {
  const participants = suggestion.participants
  const surviving = participants.find(
    (participant) => participant.companyId === survivingCompanyId
  )
  return {
    survivingCompanyId,
    name: surviving?.name ?? '',
    introductionFromCompanyId: defaultIntroductionSource(
      participants,
      survivingCompanyId
    )
  }
}

/**
 * 把一条待处理建议真的合并掉。主会社固定为编号最小的参与会社；表单只收集主名
 * 和介绍来源。记录所有者跟主名原先所属会社。官网与 parent_brand 显示并集。
 */
export const MergeSuggestionDialog = ({
  suggestion,
  onMerged,
  fallbackFocusRef
}: MergeSuggestionDialogProps) => {
  const fieldId = useId()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<MergeDraft>(() =>
    buildDraft(
      suggestion,
      smallestCompanyId(
        suggestion.participants
          .filter((participant) => participant.name !== null)
          .map((participant) => participant.companyId),
        suggestion.targetCompanyId
      )
    )
  )

  // 同步锁: await 之前先落 ref 锁, 防止连击重复提交
  const inflightRef = useRef(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const participants = suggestion.participants
  const existingParticipants = useMemo(
    () => participants.filter((participant) => participant.name !== null),
    [participants]
  )
  const missingParticipants = useMemo(
    () => participants.filter((participant) => participant.name === null),
    [participants]
  )
  const nameOptions = useMemo(
    () => buildNameOptions(participants),
    [participants]
  )
  const introductionOptions = useMemo(
    () =>
      existingParticipants.filter(
        (participant) => participant.introductionPreview.trim().length > 0
      ),
    [existingParticipants]
  )
  const selectedIntroduction = useMemo(
    () =>
      participants.find(
        (participant) =>
          participant.companyId === draft.introductionFromCompanyId
      ),
    [participants, draft.introductionFromCompanyId]
  )
  // 后端按 buildExpectedTarget 的规则写这两个数组字段 (并集去重后排序)。
  const websiteUnion = useMemo(
    () => sortedUnique(participants.flatMap((item) => item.officialWebsites)),
    [participants]
  )
  const parentBrandUnion = useMemo(
    () => sortedUnique(participants.flatMap((item) => item.parentBrands)),
    [participants]
  )

  const staleCluster = missingParticipants.length > 0
  const blocked = staleCluster

  const handleCloseAutoFocus = (event: Event) => {
    event.preventDefault()
    const trigger = triggerRef.current
    if (trigger && trigger.isConnected) {
      trigger.focus()
      return
    }
    fallbackFocusRef.current?.focus()
  }

  const handleOpenChange = (nextOpen: boolean) => {
    // 合并在途时锁定关闭 (含 Escape / 遮罩 / 取消)
    if (inflightRef.current) {
      return
    }
    if (nextOpen) {
      const survivingCompanyId = smallestCompanyId(
        existingParticipants.map((participant) => participant.companyId),
        suggestion.targetCompanyId
      )
      setDraft(buildDraft(suggestion, survivingCompanyId))
    } else {
      setError(null)
    }
    setOpen(nextOpen)
  }

  const handleMerge = async () => {
    if (inflightRef.current) {
      return
    }
    const ownerFromCompanyId = ownerCompanyIdForSelectedName(
      existingParticipants,
      draft.name
    )
    if (ownerFromCompanyId === null) {
      setError('无法确定主名原先所属会社的记录所有者')
      return
    }

    const targetId = suggestion.id
    inflightRef.current = true
    setBusy(true)
    setError(null)

    let businessError: string | null = null
    let unknownFailure = false
    let response: CompanyMergeApplyResponse | null = null
    try {
      const res = await kunFetchPost<CompanyMergeApplyResponse | string>(
        '/admin/company-merges/apply',
        {
          id: targetId,
          targetCompanyId: draft.survivingCompanyId,
          name: draft.name,
          ownerFromCompanyId,
          introductionFromCompanyId: draft.introductionFromCompanyId
        }
      )
      if (typeof res === 'string') {
        // kunFetch 约定: 任何字符串 (包括空串) 都是业务错误
        businessError = res
      } else {
        response = res
      }
    } catch {
      unknownFailure = true
    } finally {
      inflightRef.current = false
      setBusy(false)
    }

    if (response) {
      const mergedSourceIds = participants
        .filter(
          (participant) => participant.companyId !== response.targetCompanyId
        )
        .map((participant) => `#${participant.companyId}`)
        .join('、')
      const survivingName = draft.name.trim()
      toast.success(
        <span>
          已把会社 {mergedSourceIds} 合并进 #{response.targetCompanyId}
          {survivingName ? ` ${survivingName}` : ''}。
          <a
            href={`/company/${response.targetCompanyId}`}
            target="_blank"
            rel="noreferrer"
            className="ml-1 underline"
          >
            打开主会社页
          </a>
        </span>
      )
      if (response.cacheWarning) {
        toast.error(response.cacheWarning)
      }
      setOpen(false)
      setError(null)
      onMerged(targetId)
      return
    }

    if (businessError !== null) {
      setError(businessError.trim() || '合并失败，请稍后重试')
      return
    }

    if (unknownFailure) {
      toast.error('网络异常，合并结果未知，请刷新列表后核对')
      setError(
        '网络异常，合并结果未知。这次合并可能已经写入，请刷新列表确认该建议是否仍待处理，再决定是否重试。'
      )
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="destructive"
          size="sm"
          aria-label={`合并会社建议 #${suggestion.id}`}
          className="cursor-pointer"
        >
          <Merge />
          合并
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-xl"
        onCloseAutoFocus={handleCloseAutoFocus}
        onEscapeKeyDown={(event) => {
          if (inflightRef.current) {
            event.preventDefault()
          }
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>合并这条建议涉及的会社</AlertDialogTitle>
          <AlertDialogDescription>
            主会社固定为编号最小的那一家，保留其页面与
            id；其余会社会被删除，作品、官网、父品牌与别名全部并进主会社，旧链接直接
            404。主名可以选自任何参与会社，会写到主会社上。此操作不可撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>

        {staleCluster ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {missingParticipants
              .map((participant) => `#${participant.companyId}`)
              .join('、')}
            已经不存在，这条建议的会社簇已过期。请刷新列表后再处理。
          </div>
        ) : null}

        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">主会社</p>
            <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
              {participantLabel(
                existingParticipants.find(
                  (participant) =>
                    participant.companyId === draft.survivingCompanyId
                ) ?? {
                  companyId: draft.survivingCompanyId,
                  name: null,
                  aliases: [],
                  introductionPreview: '',
                  ownerId: null,
                  officialWebsites: [],
                  parentBrands: []
                }
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              固定为编号最小的参与会社。选中的主名会写到这家上，即使合并前主名属于另一家。
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor={`${fieldId}-name`} className="text-sm font-medium">
              主名
            </label>
            <Select
              value={draft.name}
              onValueChange={(value) =>
                setDraft((previous) => ({ ...previous, name: value }))
              }
              disabled={busy || staleCluster}
            >
              <SelectTrigger
                id={`${fieldId}-name`}
                className="w-full cursor-pointer disabled:cursor-default"
              >
                <SelectValue placeholder="选择主名" />
              </SelectTrigger>
              <SelectContent>
                {nameOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              只能选参与会社的名称或别名；没被选中的名称会留作别名，搜索仍能找到。
            </p>
          </div>

          <div className="space-y-2">
            <p id={`${fieldId}-introduction`} className="text-sm font-medium">
              介绍来源
            </p>
            {introductionOptions.length === 0 ? (
              <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                参与会社都没有介绍，合并后介绍为空。
              </p>
            ) : (
              <div
                role="radiogroup"
                aria-labelledby={`${fieldId}-introduction`}
                className="grid gap-2"
              >
                {introductionOptions.map((participant) => {
                  const selected =
                    participant.companyId === draft.introductionFromCompanyId
                  return (
                    <button
                      key={participant.companyId}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={busy || staleCluster}
                      onClick={() =>
                        setDraft((previous) => ({
                          ...previous,
                          introductionFromCompanyId: participant.companyId
                        }))
                      }
                      className={cn(
                        'w-full min-w-0 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                        'cursor-pointer disabled:cursor-default disabled:opacity-50',
                        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                        selected
                          ? 'border-primary bg-primary/5'
                          : 'bg-background hover:bg-accent/50'
                      )}
                    >
                      <span className="block font-medium">
                        {participantLabel(participant)}
                      </span>
                      <span className="mt-1 block text-xs font-normal break-words whitespace-pre-wrap text-muted-foreground">
                        {participant.introductionPreview}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div className="space-y-2 rounded-md border bg-muted/40 px-3 py-2">
            <p className="text-sm font-medium">合并结果预览</p>
            <p className="text-xs text-muted-foreground">
              介绍：
              {selectedIntroduction?.introductionPreview.trim()
                ? selectedIntroduction.introductionPreview
                : '无'}
            </p>
            <p className="text-xs text-muted-foreground">
              官网：
              {websiteUnion.length ? websiteUnion.join('、') : '无'}
            </p>
            <p className="text-xs text-muted-foreground">
              父品牌：
              {parentBrandUnion.length ? parentBrandUnion.join('、') : '无'}
            </p>
            <p className="text-xs text-muted-foreground">
              官网与父品牌按参与会社并集写回，本切片不可单独编辑。
            </p>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy} className="cursor-pointer">
            取消
          </AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            onClick={handleMerge}
            disabled={busy || blocked}
            className="cursor-pointer disabled:cursor-default"
          >
            {busy && <Loader2 className="animate-spin" />}
            {busy ? '合并中…' : '确认合并'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
