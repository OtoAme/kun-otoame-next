export type RankingSortField =
  | 'rating'
  | 'rating_count'
  | 'like'
  | 'favorite'
  | 'resource'
  | 'comment'
  | 'download'
  | 'view'

export interface RankingCard extends GalgameCard {
  ratingCount: number
  positiveRecommendCount: number
}
