'use client'

import {
  Card,
  CardBody,
  CardHeader,
  Divider,
  Link,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow
} from '@heroui/react'
import NextLink from 'next/link'
import { Clock3, MinusCircle, PlusCircle, ShieldCheck } from 'lucide-react'
import { KunHeader } from '~/components/kun/Header'
import {
  MOEMOEPOINT_EARN_RULES,
  MOEMOEPOINT_SPEND_RULES,
  MOEMOEPOINT_THRESHOLD_RULES
} from '~/constants/moemoepoint'

type RuleRow = {
  readonly label: string
  readonly amount?: string
  readonly detail: string
}

// 客户端组件, 但没有状态 —— 页面仍然 SSR, 不影响索引。
// 标成 'use client' 是因为 HeroUI 的 Table 是客户端组件, 在 Server Component
// 里给它传渲染函数或 collection items 容易踩边界问题; 仓库其他表格也都这么做。
const RuleTable = ({
  ariaLabel,
  rows,
  amountHeader
}: {
  ariaLabel: string
  rows: readonly RuleRow[]
  amountHeader?: string
}) => (
  <div className="overflow-x-auto">
    <Table aria-label={ariaLabel} removeWrapper>
      <TableHeader>
        <TableColumn>项目</TableColumn>
        <TableColumn>{amountHeader ?? '要求'}</TableColumn>
        <TableColumn>说明</TableColumn>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.label}>
            <TableCell className="font-medium sm:whitespace-nowrap">
              {row.label}
            </TableCell>
            <TableCell className="tabular-nums sm:whitespace-nowrap">
              {row.amount ?? '—'}
            </TableCell>
            <TableCell className="text-default-500">{row.detail}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </div>
)

const SectionCard = ({
  title,
  icon: Icon,
  iconClassName,
  children
}: {
  title: string
  icon: typeof PlusCircle
  iconClassName: string
  children: React.ReactNode
}) => (
  <Card>
    <CardHeader className="flex items-center gap-2">
      <Icon className={`size-5 ${iconClassName}`} aria-hidden="true" />
      <h2 className="text-lg font-medium">{title}</h2>
    </CardHeader>
    <Divider />
    <CardBody>{children}</CardBody>
  </Card>
)

export const MoemoepointRules = () => {
  return (
    <div className="container mx-auto my-4 space-y-6">
      <KunHeader
        name="萌萌点规则"
        description="萌萌点是社区积分, 用于记录你的贡献并约束高成本操作。以下说明奖励、扣除、回退和余额门槛。"
      />

      <Card>
        <CardBody className="space-y-3">
          <h2 className="text-lg font-medium">三个数字的含义</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex flex-col gap-1 sm:flex-row sm:gap-2">
              <dt className="font-medium sm:w-32 sm:shrink-0">总萌萌点</dt>
              <dd className="text-default-500">
                账户记录的萌萌点总数, 包含暂时不能使用的部分。
              </dd>
            </div>
            <div className="flex flex-col gap-1 sm:flex-row sm:gap-2">
              <dt className="font-medium sm:w-32 sm:shrink-0">可用萌萌点</dt>
              <dd className="text-default-500">
                总额减去待结算部分,
                消费和余额门槛都使用此值。
              </dd>
            </div>
            <div className="flex flex-col gap-1 sm:flex-row sm:gap-2">
              <dt className="font-medium sm:w-32 sm:shrink-0">待结算萌萌点</dt>
              <dd className="text-default-500">
                暂时不能使用、等待返还或确认扣除的部分。
              </dd>
            </div>
          </dl>
        </CardBody>
      </Card>

      <SectionCard
        title="萌萌点获取途径"
        icon={PlusCircle}
        iconClassName="text-success"
      >
        <RuleTable
          ariaLabel="萌萌点获取途径"
          rows={MOEMOEPOINT_EARN_RULES}
          amountHeader="变动"
        />
      </SectionCard>

      <SectionCard
        title="萌萌点扣除与回退"
        icon={MinusCircle}
        iconClassName="text-danger"
      >
        <RuleTable
          ariaLabel="萌萌点扣除与回退"
          rows={MOEMOEPOINT_SPEND_RULES}
          amountHeader="变动"
        />
      </SectionCard>

      <SectionCard
        title="余额门槛"
        icon={ShieldCheck}
        iconClassName="text-primary"
      >
        <p className="mb-3 text-sm text-default-500">
          门槛看可用萌萌点。达到门槛只代表可以进行操作, 不会扣除或冻结萌萌点。
        </p>
        <RuleTable
          ariaLabel="萌萌点余额门槛"
          rows={MOEMOEPOINT_THRESHOLD_RULES}
        />
      </SectionCard>

      <SectionCard
        title="暂扣与结算"
        icon={Clock3}
        iconClassName="text-warning"
      >
        <div className="space-y-2 text-sm text-default-500">
          <p>
            普通操作目前不会产生暂扣记录。如果某项活动使用押金机制,
            暂扣期间这笔萌萌点会计入总额但不可用, 处理完成后按结果结算。
          </p>
          <ul className="ml-5 list-disc space-y-1">
            <li>
              <span className="font-medium text-foreground">返还</span>
              ：处理通过, 冻结解除, 萌萌点重新可用。
            </li>
            <li>
              <span className="font-medium text-foreground">确认扣除</span>
              ：处理未通过, 押金从总额中扣除。
            </li>
          </ul>
          <p>每一笔暂扣只会结算一次, 不会重复返还或重复扣除。</p>
        </div>
      </SectionCard>

      <Card>
        <CardBody className="space-y-2 text-sm text-default-500">
          <h2 className="text-lg font-medium text-foreground">关于负余额</h2>
          <p>
            萌萌点总额可以为负。奖励被收回时会真实回退 —— 例如你的资源被删除,
            或点赞你内容的人取消了点赞。这样做是为了让明细完整可追溯,
            而不是把差额悄悄抹平。
          </p>
          <p>总额为负时, 你仍然可以通过签到等方式重新累积。</p>
        </CardBody>
      </Card>

      <p className="text-sm text-default-500">
        想查看自己的每一笔变动, 请前往{' '}
        <Link as={NextLink} href="/moemoepoint" size="sm">
          萌萌点明细
        </Link>
        。
      </p>
    </div>
  )
}
