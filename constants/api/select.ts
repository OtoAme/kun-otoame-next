// TODO: type
// type SelectFieldKey = Exclude<keyof GalgameCard, '_count'> & {
//   select: {
//     favorite_by: boolean
//     resource: boolean
//     comment: boolean
//   }
// }

export const GalgameCardSelectField = {
  id: true,
  unique_id: true,
  name: true,
  banner: true,
  view: true,
  download: true,
  type: true,
  language: true,
  platform: true,
  created: true,
  _count: {
    select: {
      favorite_folder: true,
      resource: true,
      comment: true
    }
  },
  rating_stat: {
    select: {
      avg_overall: true
    }
  },
  tag: {
    select: {
      tag: {
        select: { name: true }
      }
    }
  }
}

type GalgameCardCountShape = {
  favorite_folder: number
  resource: number
  comment: number
}

interface GalgameCardCounters {
  _count: GalgameCardCountShape
}

export const toGalgameCardCount = (
  row: GalgameCardCounters
): GalgameCardCountShape => row._count
