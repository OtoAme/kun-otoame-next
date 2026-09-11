import { AlertTriangle, Info } from 'lucide-react'

import { Badge } from '~/components/dashboard/ui/badge'
import type {
  PatchSubmissionCompanyDiagnostics,
  PatchSubmissionDiagnosticCandidate
} from '~/app/api/patch-submission/publishPreview'
import type { CompanyCandidate } from '~/app/api/company/identity/types'
import type {
  CompanyResolutionMatch,
  CompanyResolutionMatchedBy
} from '~/app/api/company/identity/resolver'

interface CompanyDiagnosticsProps {
  diagnostics: PatchSubmissionCompanyDiagnostics
}

const SOURCE_LABELS: Record<CompanyCandidate['source'], string> = {
  vndb: 'VNDB',
  bangumi: 'Bangumi',
  steam: 'Steam',
  dlsite: 'DLsite'
}

function sourceLabel(source: CompanyCandidate['source']): string {
  return SOURCE_LABELS[source] ?? source
}

function matchedByLabel(matchedBy: CompanyResolutionMatchedBy): string {
  switch (matchedBy) {
    case 'external-id':
      return '外部 ID'
    case 'normalized-name':
      return '标准化名称'
    case 'normalized-alias':
      return '标准化别名'
    case 'batch':
      return '批量匹配'
    default:
      return matchedBy
  }
}

function CandidateLine({ candidate }: { candidate: CompanyCandidate }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge variant="outline">{sourceLabel(candidate.source)}</Badge>
      <span className="font-medium">{candidate.name}</span>
      <span className="text-muted-foreground">
        外部 ID：{candidate.externalId}
      </span>
    </span>
  )
}

function DiagnosticCandidateList({
  candidates
}: {
  candidates: PatchSubmissionDiagnosticCandidate[]
}) {
  if (candidates.length === 0) return null
  return (
    <ul className="ml-5 list-disc space-y-1 text-muted-foreground">
      {candidates.map((entry, index) => (
        <li
          key={`${entry.candidate.source}:${entry.candidate.externalId}:${index}`}
        >
          <CandidateLine candidate={entry.candidate} />
        </li>
      ))}
    </ul>
  )
}

function MatchList({ matches }: { matches: CompanyResolutionMatch[] }) {
  if (matches.length === 0) return null
  return (
    <ul className="ml-5 list-disc space-y-1">
      {matches.map((match, index) => (
        <li key={`${match.id}:${index}`}>
          会社 #{match.id}「{match.name}」
        </li>
      ))}
    </ul>
  )
}

export function CompanyDiagnostics({ diagnostics }: CompanyDiagnosticsProps) {
  const hasPublishResult =
    diagnostics.resolvedExisting.length > 0 ||
    diagnostics.wouldCreate.length > 0

  return (
    <div className="space-y-4">
      <section className="space-y-2" aria-label="会社发布结果">
        <h5 className="flex items-center gap-2 text-sm font-medium">
          <Info className="h-4 w-4" aria-hidden />
          发布结果
        </h5>
        {hasPublishResult ? (
          <ul className="space-y-2 text-sm">
            {diagnostics.resolvedExisting.map((resolved, index) => (
              <li
                key={`resolved-${resolved.companyId}-${index}`}
                className="space-y-1"
              >
                <p>
                  将关联现有会社 #{resolved.companyId}「{resolved.name}」
                  <span className="text-muted-foreground">
                    （匹配方式：{matchedByLabel(resolved.matchedBy)}）
                  </span>
                </p>
                <DiagnosticCandidateList candidates={resolved.candidates} />
              </li>
            ))}
            {diagnostics.wouldCreate.map((create, index) => (
              <li key={`create-${create.name}-${index}`} className="space-y-1">
                <p>将新建会社「{create.name}」</p>
                <DiagnosticCandidateList candidates={create.candidates} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            本次投稿不涉及会社变更。
          </p>
        )}
      </section>

      {diagnostics.ambiguities.length > 0 ? (
        <section
          className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3"
          aria-label="阻塞性会社歧义"
        >
          <h5 className="flex items-center gap-2 text-sm font-medium text-destructive">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            阻塞性歧义（{diagnostics.ambiguities.length}）——已禁用“通过并发布”
          </h5>
          <ul className="space-y-3 text-sm">
            {diagnostics.ambiguities.map((ambiguity, index) => (
              <li key={`ambiguity-${index}`} className="space-y-1">
                <CandidateLine candidate={ambiguity.candidate} />
                <p className="text-muted-foreground">
                  {ambiguity.reason === 'multiple-companies'
                    ? '该候选匹配到多个会社，无法自动裁决。'
                    : '该候选的外部 ID 与其他会社记录冲突。'}
                </p>
                <MatchList matches={ambiguity.matchedCompanies} />
              </li>
            ))}
          </ul>
          <p className="text-sm">
            这不是投稿人可以修改的字段。请先合并或裁决会社身份；若暂时无法处理，应驳回并返还押金，不要要求投稿人修改。
          </p>
        </section>
      ) : null}

      {diagnostics.diagnostics.length > 0 ? (
        <section className="space-y-2" aria-label="非阻塞会社身份冲突">
          <h5 className="flex items-center gap-2 text-sm font-medium">
            <Info className="h-4 w-4" aria-hidden />
            非阻塞身份冲突（{diagnostics.diagnostics.length}）
          </h5>
          <ul className="space-y-3 text-sm">
            {diagnostics.diagnostics.map((conflict, index) => (
              <li key={`conflict-${index}`} className="space-y-1">
                <CandidateLine candidate={conflict.candidate} />
                <MatchList matches={conflict.matchedCompanies} />
                <p className="text-muted-foreground">
                  名称与外部 ID 指向的会社不一致：发布时将保留外部 ID
                  对应的会社，不会为其添加冲突的名称。
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {diagnostics.snapshotDiagnostics.length > 0 ? (
        <section className="space-y-2" aria-label="未使用的会社快照">
          <h5 className="flex items-center gap-2 text-sm font-medium">
            <Info className="h-4 w-4" aria-hidden />
            未使用的快照（{diagnostics.snapshotDiagnostics.length}）
          </h5>
          <ul className="ml-5 list-disc space-y-1 text-sm">
            {diagnostics.snapshotDiagnostics.map((snapshot, index) => (
              <li key={`snapshot-${snapshot.source}-${index}`}>
                <Badge variant="outline">{sourceLabel(snapshot.source)}</Badge>{' '}
                {snapshot.reason === 'invalid-snapshot' ? (
                  <span>快照无效，未参与会社解析。</span>
                ) : (
                  <span>
                    lookupId 不匹配：实际 {snapshot.lookupId ?? '（空）'}，预期{' '}
                    {snapshot.expectedLookupId ?? '（空）'}
                    ，快照未参与会社解析。
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
