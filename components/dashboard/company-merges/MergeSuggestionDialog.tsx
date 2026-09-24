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
import { Checkbox } from '~/components/dashboard/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '~/components/dashboard/ui/select'
import { cn } from '~/lib/dashboard/utils'
import { kunFetchPost } from '~/utils/kunFetch'
import {
  getCompanyMergeSuggestionKindLabel,
  type CompanyMergeApplyResponse,
  type CompanyMergeParticipant,
  type CompanyMergeSuggestion
} from '~/types/api/companyMerges'

interface MergeSuggestionDialogProps {
  suggestion: CompanyMergeSuggestion
  onMerged: (id: number) => void
  /** 合并成功后本行连同触发按钮一起卸载, 焦点退到这里。 */
  fallbackFocusRef: RefObject<HTMLElement | null>
}

interface MergeDraft {
  selectedCompanyIds: number[]
  name: string
  introductionFromCompanyId: number
}

const sortedUnique = (values: string[]) =>
  [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right, 'en')
  )

const COMPANY_LINK_CLASS =
  'rounded-sm text-primary underline-offset-4 hover:underline focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none'

const CompanyPageLink = ({
  participant
}: {
  participant: Pick<CompanyMergeParticipant, 'companyId' | 'name'>
}) => {
  if (participant.name === null) {
    return <span>#{participant.companyId}（已不存在）</span>
  }
  return (
    <a
      href={`/company/${participant.companyId}`}
      target="_blank"
      rel="noreferrer"
      className={COMPANY_LINK_CLASS}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {participant.name}
      <span className="text-xs text-muted-foreground">
        {' '}
        #{participant.companyId}
      </span>
    </a>
  )
}

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
  selectedCompanyIds: number[],
  previous?: MergeDraft
): MergeDraft => {
  const selectedParticipants = suggestion.participants.filter((participant) =>
    selectedCompanyIds.includes(participant.companyId)
  )
  const survivingCompanyId = selectedCompanyIds.length
    ? Math.min(...selectedCompanyIds)
    : suggestion.targetCompanyId
  const options = buildNameOptions(selectedParticipants)
  const surviving = selectedParticipants.find(
    (participant) => participant.companyId === survivingCompanyId
  )
  const name =
    previous && options.some((option) => option.value === previous.name)
      ? previous.name
      : (surviving?.name ?? options[0]?.value ?? '')
  const introductionStillValid =
    previous != null &&
    selectedCompanyIds.includes(previous.introductionFromCompanyId) &&
    selectedParticipants.some(
      (participant) =>
        participant.companyId === previous.introductionFromCompanyId &&
        participant.introductionPreview.trim().length > 0
    )
  return {
    selectedCompanyIds,
    name,
    introductionFromCompanyId: introductionStillValid
      ? previous.introductionFromCompanyId
      : defaultIntroductionSource(selectedParticipants, survivingCompanyId)
  }
}

/**
 * 把勾中的会社合并掉。主会社是勾中编号最小的那家。介绍、官网、父品牌和
 * 成功提示只看勾选；未勾选且已删除的会社不挡提交。
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
      suggestion.participants.map((participant) => participant.companyId)
    )
  )

  // 同步锁: await 之前先落 ref 锁, 防止连击重复提交
  const inflightRef = useRef(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const participants = suggestion.participants
  const selectedParticipants = useMemo(
    () =>
      participants.filter((participant) =>
        draft.selectedCompanyIds.includes(participant.companyId)
      ),
    [participants, draft.selectedCompanyIds]
  )
  const existingParticipants = useMemo(
    () =>
      selectedParticipants.filter((participant) => participant.name !== null),
    [selectedParticipants]
  )
  const missingParticipants = useMemo(
    () =>
      selectedParticipants.filter((participant) => participant.name === null),
    [selectedParticipants]
  )
  const survivingCompanyId = draft.selectedCompanyIds.length
    ? Math.min(...draft.selectedCompanyIds)
    : suggestion.targetCompanyId
  const nameOptions = useMemo(
    () => buildNameOptions(selectedParticipants),
    [selectedParticipants]
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
    () =>
      sortedUnique(
        selectedParticipants.flatMap((item) => item.officialWebsites)
      ),
    [selectedParticipants]
  )
  const parentBrandUnion = useMemo(
    () =>
      sortedUnique(selectedParticipants.flatMap((item) => item.parentBrands)),
    [selectedParticipants]
  )

  const tooFew = draft.selectedCompanyIds.length < 2
  const staleCluster = missingParticipants.length > 0
  const blocked = staleCluster || tooFew

  const toggleCompany = (companyId: number, checked: boolean) => {
    setDraft((previous) => {
      const selectedCompanyIds = checked
        ? [...new Set([...previous.selectedCompanyIds, companyId])].sort(
            (left, right) => left - right
          )
        : previous.selectedCompanyIds.filter((id) => id !== companyId)
      return buildDraft(suggestion, selectedCompanyIds, previous)
    })
    setError(null)
  }

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
      setDraft(
        buildDraft(
          suggestion,
          suggestion.participants.map((participant) => participant.companyId)
        )
      )
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
          selectedCompanyIds: draft.selectedCompanyIds,
          name: draft.name,
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
      const mergedSourceIds = draft.selectedCompanyIds
        .filter((companyId) => companyId !== response.targetCompanyId)
        .map((companyId) => `#${companyId}`)
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
          variant="default"
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
          <AlertDialogTitle>合并勾选的会社</AlertDialogTitle>
          <AlertDialogDescription>
            推荐原因：{getCompanyMergeSuggestionKindLabel(suggestion.kind)}。
            默认全选，至少两家。主会社是勾中编号最小的那一家，保留其页面与
            id；其余勾中的会社会被删除，作品、官网、父品牌与别名并进主会社，旧链接直接
            404。未勾选的会社不会删除。此操作不可撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>

        {staleCluster ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            勾选的{' '}
            {missingParticipants
              .map((participant) => `#${participant.companyId}`)
              .join('、')}{' '}
            已经不存在。取消这些勾选后可以只合并还在的会社；未勾选的缺行不会挡住提交。
          </div>
        ) : null}
        {tooFew ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            至少勾选两家会社。
          </div>
        ) : null}

        <div className="space-y-4">
          <div className="space-y-2">
            <p id={`${fieldId}-companies`} className="text-sm font-medium">
              要合并的会社
            </p>
            <div
              role="group"
              aria-labelledby={`${fieldId}-companies`}
              className="grid gap-2"
            >
              {participants.map((participant) => {
                const checked = draft.selectedCompanyIds.includes(
                  participant.companyId
                )
                const checkboxId = `${fieldId}-company-${participant.companyId}`
                return (
                  <label
                    key={participant.companyId}
                    htmlFor={checkboxId}
                    className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
                  >
                    <Checkbox
                      id={checkboxId}
                      checked={checked}
                      disabled={busy}
                      onCheckedChange={(value) =>
                        toggleCompany(participant.companyId, value === true)
                      }
                    />
                    <span>
                      <CompanyPageLink participant={participant} />
                      {participant.name === null ? '，未勾选则不挡住提交' : ''}
                    </span>
                  </label>
                )
              })}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">主会社</p>
            <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <CompanyPageLink
                participant={
                  selectedParticipants.find(
                    (participant) =>
                      participant.companyId === survivingCompanyId
                  ) ?? {
                    companyId: survivingCompanyId,
                    name: null
                  }
                }
              />
            </p>
            <p className="text-xs text-muted-foreground">
              固定为勾选里编号最小的会社。选中的主名会写到这家上，即使合并前主名属于另一家勾选会社。
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
              只能选勾中会社的名称或别名；没被选中的名称会留作别名，搜索仍能找到。
            </p>
          </div>

          <div className="space-y-2">
            <p id={`${fieldId}-introduction`} className="text-sm font-medium">
              介绍来源
            </p>
            {introductionOptions.length === 0 ? (
              <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                勾选的会社都没有介绍，合并后介绍为空。
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
                  const introLocked = busy || staleCluster
                  return (
                    <div
                      key={participant.companyId}
                      role="radio"
                      aria-checked={selected}
                      aria-disabled={introLocked}
                      tabIndex={introLocked ? -1 : 0}
                      onClick={() => {
                        if (introLocked) return
                        setDraft((previous) => ({
                          ...previous,
                          introductionFromCompanyId: participant.companyId
                        }))
                      }}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return
                        if (event.key !== 'Enter' && event.key !== ' ') return
                        event.preventDefault()
                        if (introLocked) return
                        setDraft((previous) => ({
                          ...previous,
                          introductionFromCompanyId: participant.companyId
                        }))
                      }}
                      className={cn(
                        'w-full min-w-0 rounded-md border px-3 py-2 text-left text-sm transition-colors',
                        'cursor-pointer focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                        introLocked && 'cursor-default opacity-50',
                        selected
                          ? 'border-primary bg-primary/5'
                          : 'bg-background hover:bg-accent/50'
                      )}
                    >
                      <span className="block font-medium">
                        <CompanyPageLink participant={participant} />
                      </span>
                      <span className="mt-1 block text-xs font-normal break-words whitespace-pre-wrap text-muted-foreground">
                        {participant.introductionPreview}
                      </span>
                    </div>
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
              官网与父品牌只按勾选会社的并集写回，未勾选的不计入。
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
            variant="default"
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
