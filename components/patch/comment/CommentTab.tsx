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
        <div className="space-y-2 text-default-600">
          <p className="mb-4">
            要反馈游戏资源问题，请在对应资源卡片点击「报告问题」，选择具体问题后提交；游戏资料问题请点击上方的「游戏反馈」。在评论区留言不会进入问题处理。
          </p>
        </div>

        <Comments id={Number(id)} />
      </CardBody>
    </Card>
  )
}
