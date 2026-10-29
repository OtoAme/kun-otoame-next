'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@heroui/button'
import { Card, CardBody, CardHeader } from '@heroui/card'
import { Input } from '@heroui/input'
import { Select, SelectItem } from '@heroui/select'
import { Tab, Tabs } from '@heroui/tabs'
import { CalendarCheck, CircleCheck, Send } from 'lucide-react'
import toast from 'react-hot-toast'
import { generateUUID } from '~/utils/random'
import { KunMarkdownEditor } from '~/components/kun/editor/MarkdownEditor'
import {
  HELP_CATEGORIES,
  HELP_CATEGORY_HINTS,
  HELP_CATEGORY_LABELS,
  HELP_CONTENT_MIN_LENGTH,
  HELP_GAME_NAME_MAX_LENGTH,
  HELP_LOW_BALANCE_HINT,
  HELP_NO_RESPONSE_DUTY,
  HELP_POST_FEE,
  HELP_TITLE_MAX_LENGTH,
  HELP_TITLE_MIN_LENGTH,
  type HelpCategory
} from '~/constants/help'
import { useUserStore } from '~/store/userStore'
import { kunFetchGet, kunFetchPost, kunFetchPut } from '~/utils/kunFetch'
import { HelpGamePicker } from './HelpGamePicker'
import { HelpGameLinksInput } from './HelpGameLinksInput'
import { isHttpUrl } from '~/utils/helpGameLinks'
import { uploadHelpImage } from './uploadHelpImage'
import { HelpStatusChip } from './HelpStatusChip'
import type { MoemoepointBalance } from '~/types/api/moemoepoint'
import type {
  HelpPatchLink,
  HelpPostCreateResponse,
  HelpPostFormState,
  HelpSimilarItem
} from '~/types/api/help'

type LinkMode = 'patch' | 'name' | 'none'

export interface HelpPostFormInitial {
  postId: number
  category: HelpCategory
  title: string
  content: string
  patch: HelpPatchLink | null
  gameName: string
  gameLinks: string[]
  resourceId: number | null
}

interface Props {
  /** Present when editing; the form then saves without a fee. */
  initial?: HelpPostFormInitial
  /** Prefill from a game or resource entry, e.g. /help/create?patch=... */
  presetPatch?: HelpPatchLink | null
  presetResourceId?: number | null
}

const newRequestId = () => generateUUID()

export const HelpPostForm = ({
  initial,
  presetPatch,
  presetResourceId
}: Props) => {
  const router = useRouter()
  const editing = Boolean(initial)
  const setMoemoepointBalance = useUserStore(
    (state) => state.setMoemoepointBalance
  )
  const user = useUserStore((state) => state.user)
  const setUser = useUserStore((state) => state.setUser)
  const checkedIn = user.dailyCheckIn === 1
  const [category, setCategory] = useState<HelpCategory | ''>(
    initial?.category ?? ''
  )
  const [title, setTitle] = useState(initial?.title ?? '')
  const [content, setContent] = useState(initial?.content ?? '')
  const startPatch = initial?.patch ?? presetPatch ?? null
  const [mode, setMode] = useState<LinkMode>(
    startPatch ? 'patch' : initial?.gameName ? 'name' : 'none'
  )
  const [patch, setPatch] = useState<HelpPatchLink | null>(startPatch)
  const [gameName, setGameName] = useState(initial?.gameName ?? '')
  const [gameLinks, setGameLinks] = useState<string[]>(initial?.gameLinks ?? [])
  const cleanLinks = gameLinks.map((link) => link.trim()).filter(Boolean)
  const resourceId =
    initial?.resourceId ?? (presetPatch ? (presetResourceId ?? null) : null)
  const [similar, setSimilar] = useState<HelpSimilarItem[]>([])
  const [formState, setFormState] = useState<HelpPostFormState | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [checkingIn, setCheckingIn] = useState(false)
  const requestIdRef = useRef(newRequestId())
  const lockRef = useRef(false)

  const loadFormState = () =>
    kunFetchGet<HelpPostFormState | string>('/help/form')
      .then((value) => {
        if (typeof value !== 'string') setFormState(value)
      })
      .catch(() => undefined)

  useEffect(() => {
    if (!editing) loadFormState()
  }, [editing])

  // Similar posts by title and linked game, debounced.
  const linkedPatchId = mode === 'patch' ? patch?.id : undefined
  useEffect(() => {
    if (editing) return
    const query = title.trim()
    if (query.length < 2 && !linkedPatchId) {
      setSimilar([])
      return
    }
    let ignore = false
    const timer = setTimeout(() => {
      kunFetchGet<HelpSimilarItem[] | string>('/help/similar', {
        title: query,
        ...(linkedPatchId ? { patchId: linkedPatchId } : {})
      })
        .then((value) => {
          if (!ignore) setSimilar(typeof value === 'string' ? [] : value)
        })
        .catch(() => {
          if (!ignore) setSimilar([])
        })
    }, 400)
    return () => {
      ignore = true
      clearTimeout(timer)
    }
  }, [title, linkedPatchId, editing])

  const available = formState?.balance.available ?? null
  const insufficient =
    !editing && available !== null && available < HELP_POST_FEE
  const limitReached =
    !editing &&
    formState !== null &&
    formState.postsToday >= formState.dailyLimit
  const titleLength = title.trim().length
  const contentLength = content.trim().length
  const invalid =
    !category ||
    titleLength < HELP_TITLE_MIN_LENGTH ||
    titleLength > HELP_TITLE_MAX_LENGTH ||
    contentLength < HELP_CONTENT_MIN_LENGTH ||
    (mode === 'patch' && !patch) ||
    (mode === 'name' && !gameName.trim()) ||
    (mode === 'name' && !cleanLinks.every(isHttpUrl))

  const handleCheckIn = async () => {
    if (checkingIn) return
    setCheckingIn(true)
    try {
      const res = await kunFetchPost<
        { randomMoemoepoints: number; balance: MoemoepointBalance } | string
      >('/user/status/check-in')
      if (typeof res === 'string') {
        toast.error(res)
        // Already checked in today: show the done state instead of a button
        // that can only fail again.
        if (res.includes('已经签到')) setUser({ ...user, dailyCheckIn: 1 })
      } else {
        toast.success(`签到成功，获得 ${res.randomMoemoepoints} 萌萌点`)
        setUser({ ...user, dailyCheckIn: 1 })
        setMoemoepointBalance(res.balance)
        await loadFormState()
      }
    } catch {
      toast.error('签到失败，请稍后重试')
    } finally {
      setCheckingIn(false)
    }
  }

  const handleSubmit = async () => {
    if (invalid || lockRef.current) return
    lockRef.current = true
    setSubmitting(true)
    const link = {
      patchId: mode === 'patch' ? (patch?.id ?? null) : null,
      gameName: mode === 'name' ? gameName.trim() : '',
      gameLinks: mode === 'name' ? cleanLinks : [],
      resourceId: mode === 'patch' ? resourceId : null
    }
    try {
      if (initial) {
        const res = await kunFetchPut<{ postId: number } | string>(
          '/help/post',
          {
            postId: initial.postId,
            category,
            title: title.trim(),
            content: content.trim(),
            ...link
          }
        )
        if (typeof res === 'string') {
          toast.error(res)
          return
        }
        toast.success('求助已保存')
        router.push(`/help/${initial.postId}`)
        router.refresh()
        return
      }
      const res = await kunFetchPost<HelpPostCreateResponse | string>(
        '/help/post',
        {
          requestId: requestIdRef.current,
          category,
          title: title.trim(),
          content: content.trim(),
          ...link
        }
      )
      if (typeof res === 'string') {
        // 失败保留输入；换一个请求标识，避免沿用失败的那次
        toast.error(res)
        requestIdRef.current = newRequestId()
        return
      }
      setMoemoepointBalance(res.moemoepointBalance)
      toast.success('求助已发布')
      router.push(`/help/${res.postId}`)
    } catch {
      toast.error('网络错误，请稍后重试')
    } finally {
      lockRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex-col items-start gap-1">
        <h1 className="text-xl font-medium">
          {editing ? '编辑求助' : '发布求助'}
        </h1>
        <p className="text-sm text-default-500">{HELP_NO_RESPONSE_DUTY}</p>
      </CardHeader>
      <CardBody className="gap-5">
        <Select
          isRequired
          label="分类"
          labelPlacement="outside"
          placeholder="请选择分类"
          selectedKeys={category ? [category] : []}
          onSelectionChange={(keys) => {
            const value = Array.from(keys)[0]
            if (value) setCategory(value as HelpCategory)
          }}
          description={category ? HELP_CATEGORY_HINTS[category] : undefined}
        >
          {HELP_CATEGORIES.map((item) => (
            <SelectItem key={item} description={HELP_CATEGORY_HINTS[item]}>
              {HELP_CATEGORY_LABELS[item]}
            </SelectItem>
          ))}
        </Select>

        <div className="space-y-2">
          <p className="text-sm">关联游戏（可选）</p>
          <Tabs
            aria-label="关联游戏"
            size="sm"
            selectedKey={mode}
            onSelectionChange={(key) => setMode(key as LinkMode)}
          >
            <Tab key="patch" title="站内游戏" />
            <Tab key="name" title="只填游戏名" />
            <Tab key="none" title="不关联" />
          </Tabs>
          {mode === 'patch' && (
            <HelpGamePicker
              value={patch}
              onChange={setPatch}
              isDisabled={submitting}
            />
          )}
          {mode === 'name' && (
            <Input
              aria-label="游戏名"
              placeholder="本站还没有这部游戏时，填写游戏名"
              value={gameName}
              onValueChange={setGameName}
              maxLength={HELP_GAME_NAME_MAX_LENGTH}
            />
          )}
          {mode === 'name' && (
            <HelpGameLinksInput
              links={gameLinks}
              onChange={setGameLinks}
              isDisabled={submitting}
            />
          )}
          {mode === 'patch' && resourceId !== null && patch && (
            <p className="text-xs text-default-500">
              已带上来源资源，资源发布者会收到提醒。
            </p>
          )}
        </div>

        <Input
          isRequired
          label="标题"
          labelPlacement="outside"
          placeholder="一句话说明遇到的问题"
          value={title}
          onValueChange={setTitle}
          maxLength={HELP_TITLE_MAX_LENGTH}
          description={`${HELP_TITLE_MIN_LENGTH}～${HELP_TITLE_MAX_LENGTH} 个字符`}
        />

        {similar.length > 0 && (
          <div className="space-y-2 rounded-medium bg-default-100 p-3">
            <p className="text-sm font-medium">发帖前看看相似求助</p>
            <ul className="space-y-1">
              {similar.map((item) => (
                <li key={item.id} className="flex items-center gap-2 text-sm">
                  <HelpStatusChip status={item.status} />
                  <Link
                    href={`/help/${item.id}`}
                    target="_blank"
                    className="break-all hover:underline"
                  >
                    {item.title}
                  </Link>
                  <span className="shrink-0 text-xs text-default-400">
                    {item.answerCount} 个回答
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-1">
          <p className="text-sm">
            正文<span className="text-danger">*</span>
          </p>
          <p className="text-xs text-default-500">
            写清系统环境、出错提示和已经尝试过的办法，回答者才好判断。
          </p>
          <KunMarkdownEditor
            value={content}
            onChange={setContent}
            minHeight={220}
            onUploadImage={uploadHelpImage}
          />
        </div>

        {!editing && (
          <div className="space-y-2 rounded-medium border border-default-200 p-3 text-sm">
            <p>
              发布费 {HELP_POST_FEE}{' '}
              萌萌点，发布成功才扣；发布失败不扣费。发布后删帖、被举报隐藏或没人回答，都不退。
            </p>
            {available !== null && (
              <p>
                当前可用 {available} 点，发布后剩余{' '}
                {Math.max(available - HELP_POST_FEE, 0)} 点。
              </p>
            )}
            {formState && (
              <p className="text-xs text-default-500">
                今天已发布 {formState.postsToday}/{formState.dailyLimit} 条
              </p>
            )}
            {insufficient && (
              <div className="flex flex-wrap items-center gap-2 text-warning">
                <span>
                  {checkedIn
                    ? '余额不足，今天已经签到，明天签到后可再获得萌萌点'
                    : HELP_LOW_BALANCE_HINT}
                </span>
                <Button
                  size="sm"
                  variant="flat"
                  color={checkedIn ? 'default' : 'warning'}
                  startContent={
                    checkedIn ? (
                      <CircleCheck className="size-4" />
                    ) : (
                      <CalendarCheck className="size-4" />
                    )
                  }
                  isLoading={checkingIn}
                  isDisabled={checkedIn}
                  onPress={handleCheckIn}
                >
                  {checkedIn ? '今日已签到' : '每日签到'}
                </Button>
              </div>
            )}
            {limitReached && (
              <p className="text-warning">今天的发布次数已用完，请明天再试</p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="flat" onPress={() => router.back()}>
            取消
          </Button>
          <Button
            color="primary"
            startContent={<Send className="size-4" />}
            isDisabled={invalid || insufficient || limitReached || submitting}
            isLoading={submitting}
            onPress={handleSubmit}
          >
            {editing ? '保存' : `发布（${HELP_POST_FEE} 萌萌点）`}
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}
