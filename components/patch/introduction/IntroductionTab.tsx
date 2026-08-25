'use client'

import { Card, CardBody } from '@heroui/card'
import { Info } from './Info'
import { PatchTag } from './Tag'
import type { PatchIntroduction } from '~/types/api/patch'

import { PatchCompany } from './Company'
import { Gallery } from '../gallery/Gallery'
import { PatchOfficialUrl } from './OfficialUrl'
import { PatchIntroductionContent } from './PatchIntroductionContent'

interface Props {
  intro: PatchIntroduction
  patchId: number
  uid?: number
}

export const IntroductionTab = ({ intro, patchId, uid }: Props) => {
  return (
    <Card className="p-1 sm:p-8">
      <CardBody className="p-4 space-y-6">
        <PatchIntroductionContent html={intro.introduction} />

        <Gallery images={intro.images} />

        {uid && <PatchTag patchId={patchId} initialTags={intro.tag} />}

        <PatchOfficialUrl url={intro.officialUrl} />

        <PatchCompany
          patchId={patchId}
          initialCompanies={intro.company}
          vndbId={intro.vndbId}
        />

        <Info intro={intro} />
      </CardBody>
    </Card>
  )
}
