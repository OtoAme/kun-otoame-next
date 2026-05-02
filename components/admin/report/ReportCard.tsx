'use client'

import { useState } from 'react'
import {
  Avatar,
  Button,
  Card,
  CardBody,
  Chip,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Textarea,
  useDisclosure
} from '@heroui/react'
import { KunAvatar } from '~/components/kun/floating-card/KunAvatar'
import { formatDate } from '~/utils/time'
import { ReportHandler } from './ReportHandler'
import type { AdminReport } from '~/types/api/admin'
import { kunFetchPost } from '~/utils/kunFetch'
import toast from 'react-hot-toast'

interface Props {
  report: AdminReport
  onHandled: () => void
}

export const ReportCard = ({ report, onHandled }: Props) => {
  const [reportStatus, setReportStatus] = useState(report.status)
  const [handleContent, setHandleContent] = useState('')
  const [actionType, setActionType] = useState<'delete' | 'reject'>('delete')
  const [updating, setUpdating] = useState(false)
  const { isOpen, onOpen, onClose } = useDisclosure()
  const displayedUid = report.reportedUser.id
  const displayedName = report.reportedUser.name
  const displayedAvatar = report.reportedUser.avatar
  const targetPreview =
    report.targetType === 'rating'
      ? report.rating
        ? `${report.rating.shortSummary || `总分 ${report.rating.overall}/10`}`
        : '评价已被删除'
      : report.comment?.content || '评论已被删除'

  const openActionModal = (action: 'delete' | 'reject') => {
    setActionType(action)
    setHandleContent('')
    onOpen()
  }

  const handleUpdateReport = async () => {
    setUpdating(true)
    const res = await kunFetchPost<KunResponse<{}>>('/admin/report/handle', {
      reportId: report.id,
      action: actionType,
      content: handleContent.trim()
    })
    if (typeof res === 'string') {
      toast.error(res)
    } else {
      setReportStatus(actionType === 'reject' ? 3 : 2)
      onClose()
      setHandleContent('')
      toast.success(actionType === 'reject' ? '驳回举报成功!' : '处理举报成功!')
      onHandled()
    }
    setUpdating(false)
  }

  const statusColor: 'success' | 'danger' | 'warning' =
    reportStatus === 0 ? 'danger' : reportStatus === 3 ? 'warning' : 'success'
  const statusLabel =
    reportStatus === 0 ? '未处理' : reportStatus === 3 ? '已驳回' : '已处理'

  return (
    <>
      <Card>
        <CardBody>
          <div className="flex items-start justify-between">
            <div className="flex gap-4">
              {displayedUid ? (
                <KunAvatar
                  uid={displayedUid}
                  avatarProps={{
                    name: displayedName,
                    src: displayedAvatar
                  }}
                />
              ) : (
                <Avatar
                  name={displayedName.charAt(0).toUpperCase()}
                  className="shrink-0"
                  src={displayedAvatar}
                />
              )}
              <div>
                <div className="flex items-center gap-2">
                  <Chip size="sm" variant="flat">
                    {report.targetType === 'rating' ? '被举报评价用户' : '被举报评论用户'}
                  </Chip>
                  <h2 className="font-semibold">{displayedName}</h2>
                  <span className="text-small text-default-500">
                    {formatDate(report.created, {
                      isPrecise: true,
                      isShowYear: true
                    })}
                  </span>
                </div>
                <div className="mt-2 space-y-2">
                  <p className="whitespace-pre-wrap">举报原因: {report.reason}</p>
                  <p className="text-small text-default-500 whitespace-pre-wrap">
                    被举报内容: {targetPreview}
                  </p>
                </div>

                <div className="flex items-center gap-4 mt-2">
                  <Chip color={statusColor} variant="flat">
                    {statusLabel}
                  </Chip>
                  <Button
                    size="sm"
                    color="danger"
                    variant="flat"
                    onPress={() => openActionModal('delete')}
                    isDisabled={reportStatus !== 0}
                  >
                    删除
                  </Button>
                  <Button
                    size="sm"
                    color="warning"
                    variant="flat"
                    onPress={() => openActionModal('reject')}
                    isDisabled={reportStatus !== 0}
                  >
                    驳回
                  </Button>
                </div>
              </div>
            </div>

            <ReportHandler initialReport={report} />
          </div>
        </CardBody>
      </Card>

      <Modal isOpen={isOpen} onClose={onClose} placement="center">
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            {actionType === 'reject' ? '驳回举报' : '处理举报'}
          </ModalHeader>
          <ModalBody>
            <Textarea
              value={handleContent}
              label="反馈回复内容 (可选)"
              onChange={(e) => setHandleContent(e.target.value)}
              placeholder={
                actionType === 'reject'
                  ? '留空将使用默认回复：已驳回'
                  : '留空将使用默认回复：已处理'
              }
              minRows={2}
              maxRows={8}
            />
          </ModalBody>
          <ModalFooter>
            <Button
              variant="light"
              onPress={() => {
                setHandleContent('')
                onClose()
              }}
            >
              取消
            </Button>
            <Button
              color={actionType === 'reject' ? 'warning' : 'danger'}
              onPress={handleUpdateReport}
              isDisabled={updating}
              isLoading={updating}
            >
              {actionType === 'reject' ? '确认驳回' : '确认删除'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
