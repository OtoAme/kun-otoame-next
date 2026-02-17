import { Card, CardBody, CardHeader } from '@heroui/card'
import { Comments } from '~/components/patch/comment/Comments'

interface Props {
  id: number
}

export const CommentTab = ({ id }: Props) => {
  return (
    <Card className="p-1 sm:p-8">
      <CardHeader className="p-4">
        <h2 className="text-2xl font-medium">游戏评论</h2>
      </CardHeader>
      <CardBody className="p-4">
        <div className="mb-6 text-default-600">
          要反馈游戏资源问题，请点击上方图片右侧的“问题反馈”。在评论区反馈管理员不会收到通知。
        </div>

        <Comments id={Number(id)} />
      </CardBody>
    </Card>
  )
}
