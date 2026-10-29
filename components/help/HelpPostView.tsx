'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@heroui/button'
import { Card, CardBody, CardHeader } from '@heroui/card'
import { Chip } from '@heroui/chip'
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  useDisclosure
} from '@heroui/modal'
import {
  CheckCircle2,
  Flag,
  Info,
  Reply,
  Pencil,
  Send,
  ThumbsUp,
  Trash2,
  Bell,
  BellRing
} from 'lucide-react'
import toast from 'react-hot-toast'
import {
  CaseViolationReportModal,
  type CaseViolationTarget
} from '~/components/case/CaseViolationReportModal'
import { generateUUID } from '~/utils/random'
import { KunMarkdownEditor } from '~/components/kun/editor/MarkdownEditor'
import {
  HELP_ANSWER_REWARD,
  HELP_CATEGORY_LABELS,
  HELP_NO_RESPONSE_DUTY,
  HELP_RESOURCE_SHARE_HINT
} from '~/constants/help'
import { useMounted } from '~/hooks/useMounted'
import { useUserStore } from '~/store/userStore'
import {
  kunFetchDelete,
  kunFetchGet,
  kunFetchPost,
  kunFetchPut
} from '~/utils/kunFetch'
import { formatTimeDifference } from '~/utils/time'
import { KunExternalLink } from '~/components/kun/external-link/ExternalLink'
import { describeHelpGameLink } from '~/utils/helpGameLinks'
import { HelpGameChip } from './HelpGameChip'
import { HelpImageLightbox } from './HelpImageLightbox'
import { HelpLayout } from './HelpLayout'
import { HelpUserLink } from './HelpUserLink'
import { HelpReplyThread } from './HelpReplyThread'
import { HelpRichContent } from './HelpRichContent'
import { HelpSidebar } from './HelpSidebar'
import { uploadHelpImage } from './uploadHelpImage'
import { HelpStatusChip } from './HelpStatusChip'
import type {
  HelpAcceptResponse,
  HelpAnswer,
  HelpPostDetail
} from '~/types/api/help'

interface Props {
  initial: HelpPostDetail
}

type Confirm =
  | { type: 'delete-post' }
  | { type: 'delete-answer'; answerId: number }
  | { type: 'accept'; answerId: number | null }

const newRequestId = () => generateUUID()

export const HelpPostView = ({ initial }: Props) => {
  const router = useRouter()
  const mounted = useMounted()
  const uid = useUserStore((state) => state.user.uid)
  const role = useUserStore((state) => state.user.role)
  const [post, setPost] = useState(initial)
  const [answer, setAnswer] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  // Per-answer counter: the answer's 回复 button bumps it to open its composer.
  const [composeSignals, setComposeSignals] = useState<Record<number, number>>(
    {}
  )
  const [reportTarget, setReportTarget] = useState<{
    target: CaseViolationTarget
    title: string
    subject: string
  } | null>(null)
  const requestIdRef = useRef(newRequestId())
  const threadRef = useRef<HTMLDivElement>(null)
  const confirmModal = useDisclosure()
  const reportModal = useDisclosure()
  const loggedIn = mounted && uid > 0

  const reload = async () => {
    const fresh = await kunFetchGet<HelpPostDetail | string>('/help/post', {
      postId: post.id
    })
    if (typeof fresh === 'string') {
      toast.error(fresh)
      return
    }
    setPost(fresh)
  }

  const requireLogin = () => {
    if (loggedIn) return true
    toast('请先登录')
    router.push('/login')
    return false
  }

  const handleAnswer = async () => {
    const content = answer.trim()
    if (!content || submitting) return
    setSubmitting(true)
    try {
      const res = await kunFetchPost<{ answerId: number } | string>(
        '/help/answer',
        { postId: post.id, requestId: requestIdRef.current, content }
      )
      if (typeof res === 'string') {
        toast.error(res)
        requestIdRef.current = newRequestId()
        return
      }
      toast.success('回答已发布')
      setAnswer('')
      requestIdRef.current = newRequestId()
      await reload()
    } catch {
      toast.error('网络错误，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  const handleSaveEdit = async (answerId: number) => {
    const content = editText.trim()
    if (!content || busy) return
    setBusy(true)
    try {
      const res = await kunFetchPut<{ answerId: number } | string>(
        '/help/answer',
        { answerId, content }
      )
      if (typeof res === 'string') {
        toast.error(res)
        return
      }
      setEditingId(null)
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const toggleUseful = async (item: HelpAnswer) => {
    if (!requireLogin() || busy) return
    setBusy(true)
    try {
      const res = await kunFetchPost<
        { usefulCount: number; isUseful: boolean } | string
      >('/help/useful', { answerId: item.id, active: !item.isUseful })
      if (typeof res === 'string') {
        toast.error(res)
        return
      }
      setPost((current) => ({
        ...current,
        answers: current.answers.map((entry) =>
          entry.id === item.id ? { ...entry, ...res } : entry
        )
      }))
    } finally {
      setBusy(false)
    }
  }

  const toggleFollow = async () => {
    if (!requireLogin() || busy) return
    setBusy(true)
    try {
      const res = await kunFetchPost<
        { followCount: number; isFollowing: boolean } | string
      >('/help/follow', { postId: post.id, active: !post.isFollowing })
      if (typeof res === 'string') {
        toast.error(res)
        return
      }
      setPost((current) => ({ ...current, ...res }))
    } finally {
      setBusy(false)
    }
  }

  const openConfirm = (value: Confirm) => {
    setConfirm(value)
    confirmModal.onOpen()
  }

  const runConfirm = async () => {
    if (!confirm || busy) return
    setBusy(true)
    try {
      if (confirm.type === 'delete-post') {
        const res = await kunFetchDelete<{ postId: number } | string>(
          '/help/post',
          { postId: post.id }
        )
        if (typeof res === 'string') {
          toast.error(res)
          return
        }
        toast.success('求助已删除')
        confirmModal.onClose()
        router.push('/help')
        return
      }
      if (confirm.type === 'delete-answer') {
        const res = await kunFetchDelete<{ answerId: number } | string>(
          '/help/answer',
          { answerId: confirm.answerId }
        )
        if (typeof res === 'string') {
          toast.error(res)
          return
        }
        toast.success('回答已删除')
      } else {
        const res = await kunFetchPost<HelpAcceptResponse | string>(
          '/help/accept',
          { postId: post.id, answerId: confirm.answerId }
        )
        if (typeof res === 'string') {
          toast.error(res)
          return
        }
        toast.success(
          confirm.answerId === null
            ? '已取消采纳'
            : res.rewarded
              ? `已采纳，回答者获得 ${HELP_ANSWER_REWARD} 萌萌点`
              : '已采纳'
        )
      }
      confirmModal.onClose()
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const openReport = (
    target: CaseViolationTarget,
    title: string,
    subject: string
  ) => {
    if (!requireLogin()) return
    setReportTarget({ target, title, subject })
    reportModal.onOpen()
  }

  const confirmText = (() => {
    if (!confirm) return { title: '', body: '' }
    if (confirm.type === 'delete-post') {
      return {
        title: '删除求助',
        body: '删除后其他人将看不到这条求助，发布费不退。确定删除吗？'
      }
    }
    if (confirm.type === 'delete-answer') {
      return {
        title: '删除回答',
        body: '删除后其他人将看不到这条回答。确定删除吗？'
      }
    }
    if (confirm.answerId === null) {
      return {
        title: '取消采纳',
        body: '求助会回到「未解决」。已经发出的采纳奖励不会收回。'
      }
    }
    return {
      title: post.acceptedAnswerId ? '改选采纳' : '采纳回答',
      body: post.acceptedAnswerId
        ? '改选后求助仍为「已解决」。采纳奖励每条求助只发一次，已经发出的不会转移。'
        : `采纳后求助变为「已解决」。每条求助第一次采纳合格回答时，系统会给回答者 ${HELP_ANSWER_REWARD} 萌萌点；提问者与回答者都需注册满 7 天。`
    }
  })()

  const isAdmin = mounted && role >= 3

  return (
    <HelpLayout sidebar={<HelpSidebar />}>
      <div ref={threadRef} className="space-y-6">
        <HelpImageLightbox rootRef={threadRef}>
          <Card>
            <CardHeader className="flex-col items-start gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <HelpStatusChip status={post.status} />
                <Chip size="sm" variant="bordered">
                  {HELP_CATEGORY_LABELS[post.category]}
                </Chip>
                <HelpGameChip
                  patch={post.patch}
                  gameName={post.gameName}
                  linkCount={post.gameLinks.length}
                />
                {post.hidden && (
                  <Chip size="sm" color="danger" variant="flat">
                    已被隐藏，只有你和网站管理员能看到
                  </Chip>
                )}
              </div>
              <h1 className="break-words text-2xl font-medium">{post.title}</h1>
              <div className="flex flex-wrap items-center gap-3 text-sm text-default-500">
                <HelpUserLink user={post.user} />
                <span>{formatTimeDifference(post.created)}</span>
              </div>
            </CardHeader>
            <CardBody className="gap-4">
              <HelpRichContent html={post.content} />
              {post.resource && (
                <p className="text-sm">
                  来源资源：
                  <Link
                    href={post.resource.href}
                    className="text-primary hover:underline"
                  >
                    {post.resource.name}
                  </Link>
                </p>
              )}
              {!post.patch && post.gameName && (
                // Ordinary users and creators add entries by submission;
                // only super administrators can create one directly.
                <p className="text-sm text-default-500">
                  本站尚无此游戏，欢迎在{' '}
                  <Link
                    href="/workspace/entries"
                    className="text-primary hover:underline"
                  >
                    工作台「我的条目」
                  </Link>{' '}
                  投稿这部游戏，审核通过后就能关联到站内条目。
                </p>
              )}
              {!post.patch && post.gameName && post.gameLinks.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-default-500">资料链接：</span>
                  {post.gameLinks.map((link) => (
                    <KunExternalLink key={link} link={link}>
                      {describeHelpGameLink(link).label}
                    </KunExternalLink>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {!post.isAuthor && (
                  <Button
                    size="sm"
                    variant={post.isFollowing ? 'solid' : 'flat'}
                    color={post.isFollowing ? 'primary' : 'default'}
                    startContent={
                      post.isFollowing ? (
                        <BellRing className="size-4" />
                      ) : (
                        <Bell className="size-4" />
                      )
                    }
                    isDisabled={busy || post.hidden}
                    onPress={toggleFollow}
                  >
                    {post.isFollowing ? '已关注此帖' : '关注此帖'} ·{' '}
                    {post.followCount}
                  </Button>
                )}
                {post.isAuthor && (
                  <>
                    <Button
                      size="sm"
                      variant="flat"
                      startContent={<Pencil className="size-4" />}
                      as={Link}
                      href={`/help/${post.id}/edit`}
                    >
                      编辑
                    </Button>
                    {post.canDelete ? (
                      <Button
                        size="sm"
                        variant="flat"
                        color="danger"
                        startContent={<Trash2 className="size-4" />}
                        onPress={() => openConfirm({ type: 'delete-post' })}
                      >
                        删除
                      </Button>
                    ) : (
                      <span className="text-xs text-default-400">
                        已有他人回答，不能删除；确需删除请联系网站管理员
                      </span>
                    )}
                  </>
                )}
                {!post.isAuthor && !isAdmin && (
                  <Button
                    size="sm"
                    variant="light"
                    startContent={<Flag className="size-4" />}
                    onPress={() =>
                      openReport(
                        { targetType: 'help', targetId: post.id },
                        '举报求助',
                        `求助「${post.title.slice(0, 30)}」`
                      )
                    }
                  >
                    举报
                  </Button>
                )}
              </div>
            </CardBody>
          </Card>

          <section className="space-y-3" aria-label="回答">
            <h2 className="text-lg font-medium">
              {post.answers.length} 个回答
            </h2>
            {post.answers.map((item) => {
              const own = item.canEdit
              return (
                <Card
                  key={item.id}
                  id={`answer-${item.id}`}
                  className={
                    item.isAccepted ? 'border-2 border-success' : undefined
                  }
                >
                  <CardBody className="gap-3">
                    <div className="flex flex-wrap items-center gap-2 text-sm text-default-500">
                      <HelpUserLink user={item.user} />
                      <span>{formatTimeDifference(item.created)}</span>
                      {item.isAccepted && (
                        <Chip
                          size="sm"
                          color="success"
                          variant="flat"
                          startContent={<CheckCircle2 className="size-3.5" />}
                        >
                          已采纳
                        </Chip>
                      )}
                      {item.hidden && (
                        <Chip size="sm" color="danger" variant="flat">
                          已被隐藏
                        </Chip>
                      )}
                    </div>
                    {editingId === item.id ? (
                      <div className="space-y-2">
                        <KunMarkdownEditor
                          value={editText}
                          onChange={setEditText}
                          minHeight={160}
                          onUploadImage={uploadHelpImage}
                        />
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="flat"
                            onPress={() => setEditingId(null)}
                          >
                            取消
                          </Button>
                          <Button
                            size="sm"
                            color="primary"
                            isLoading={busy}
                            isDisabled={!editText.trim()}
                            onPress={() => handleSaveEdit(item.id)}
                          >
                            保存
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <HelpRichContent html={item.content} variant="answer" />
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant={item.isUseful ? 'solid' : 'flat'}
                        color={item.isUseful ? 'primary' : 'default'}
                        startContent={<ThumbsUp className="size-4" />}
                        isDisabled={own || item.hidden || busy}
                        onPress={() => toggleUseful(item)}
                        aria-label={`有用，当前 ${item.usefulCount}`}
                      >
                        有用 · {item.usefulCount}
                      </Button>
                      {loggedIn && !post.hidden && !item.hidden && (
                        <Button
                          size="sm"
                          variant="flat"
                          startContent={<Reply className="size-4" />}
                          onPress={() =>
                            setComposeSignals((current) => ({
                              ...current,
                              [item.id]: (current[item.id] ?? 0) + 1
                            }))
                          }
                        >
                          回复
                        </Button>
                      )}
                      {post.isAuthor &&
                        !own &&
                        !item.hidden &&
                        (item.isAccepted ? (
                          <Button
                            size="sm"
                            variant="flat"
                            onPress={() =>
                              openConfirm({ type: 'accept', answerId: null })
                            }
                          >
                            取消采纳
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="flat"
                            color="success"
                            startContent={<CheckCircle2 className="size-4" />}
                            onPress={() =>
                              openConfirm({ type: 'accept', answerId: item.id })
                            }
                          >
                            {post.acceptedAnswerId ? '改选为采纳' : '采纳'}
                          </Button>
                        ))}
                      {own && editingId !== item.id && (
                        <Button
                          size="sm"
                          variant="light"
                          startContent={<Pencil className="size-4" />}
                          onPress={() => {
                            setEditingId(item.id)
                            setEditText(item.markdown ?? '')
                          }}
                        >
                          编辑
                        </Button>
                      )}
                      {own && item.canDelete && (
                        <Button
                          size="sm"
                          variant="light"
                          color="danger"
                          startContent={<Trash2 className="size-4" />}
                          onPress={() =>
                            openConfirm({
                              type: 'delete-answer',
                              answerId: item.id
                            })
                          }
                        >
                          删除
                        </Button>
                      )}
                      {!own && !isAdmin && (
                        <Button
                          size="sm"
                          variant="light"
                          startContent={<Flag className="size-4" />}
                          onPress={() =>
                            openReport(
                              { targetType: 'help_answer', targetId: item.id },
                              '举报回答',
                              `${item.user?.name ?? '已注销用户'}的回答`
                            )
                          }
                        >
                          举报
                        </Button>
                      )}
                    </div>
                    <HelpReplyThread
                      answerId={item.id}
                      answerAuthor={item.user}
                      replies={item.replies}
                      composeSignal={composeSignals[item.id] ?? 0}
                      canReply={loggedIn && !post.hidden && !item.hidden}
                      isAdmin={isAdmin}
                      onRequireLogin={requireLogin}
                      onChanged={reload}
                      onReport={openReport}
                    />
                  </CardBody>
                </Card>
              )
            })}
          </section>
        </HelpImageLightbox>
      </div>

      {post.hidden ? null : loggedIn ? (
        <Card>
          <CardHeader className="flex-col items-start gap-1">
            <h2 className="text-lg font-medium">写回答</h2>
            <p className="flex items-start gap-1 text-xs text-default-500">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                {HELP_RESOURCE_SHARE_HINT}
                {post.patch && (
                  <>
                    {' '}
                    <Link
                      href={`/${post.patch.uniqueId}?tab=resources`}
                      target="_blank"
                      className="text-primary hover:underline"
                    >
                      去「{post.patch.name}」的资源区
                    </Link>
                  </>
                )}
              </span>
            </p>
          </CardHeader>
          <CardBody className="gap-3">
            <KunMarkdownEditor
              value={answer}
              onChange={setAnswer}
              minHeight={180}
              onUploadImage={uploadHelpImage}
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-default-400">
                {HELP_NO_RESPONSE_DUTY}
              </p>
              <Button
                color="primary"
                startContent={<Send className="size-4" />}
                isDisabled={!answer.trim() || submitting}
                isLoading={submitting}
                onPress={handleAnswer}
              >
                发布回答
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : mounted ? (
        <Card>
          <CardBody className="flex-row items-center justify-between">
            <span className="text-sm text-default-500">登录后可以回答</span>
            <Button as={Link} href="/login" color="primary" size="sm">
              登录
            </Button>
          </CardBody>
        </Card>
      ) : null}

      <Modal
        isOpen={confirmModal.isOpen}
        onClose={confirmModal.onClose}
        placement="center"
      >
        <ModalContent>
          <ModalHeader>{confirmText.title}</ModalHeader>
          <ModalBody>
            <p className="text-sm">{confirmText.body}</p>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={confirmModal.onClose}>
              取消
            </Button>
            <Button
              color={
                confirm?.type === 'delete-post' ||
                confirm?.type === 'delete-answer'
                  ? 'danger'
                  : 'primary'
              }
              isLoading={busy}
              onPress={runConfirm}
            >
              确认
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {reportTarget && (
        <CaseViolationReportModal
          isOpen={reportModal.isOpen}
          onClose={reportModal.onClose}
          title={reportTarget.title}
          subject={reportTarget.subject}
          target={reportTarget.target}
        />
      )}
    </HelpLayout>
  )
}
