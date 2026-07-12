import type { Stat } from '../types'

export const stats: Stat[] = [
  {
    id: 'trips',
    label: '總行程數',
    value: '12',
    helper: '本月 +2',
    helperTone: 'positive',
    tone: 'brand',
    icon: 'compass',
  },
  {
    id: 'days',
    label: '規劃天數',
    value: '84',
    helper: '所有行程加總',
    helperTone: 'neutral',
    tone: 'culture',
    icon: 'calendar',
  },
  {
    id: 'places',
    label: '已收藏地點',
    value: '247',
    helper: '本週 +18',
    helperTone: 'positive',
    tone: 'coral',
    icon: 'pin',
  },
  {
    id: 'budget',
    label: '總預算',
    value: '$24.8k',
    helper: '所有行程加總',
    helperTone: 'neutral',
    tone: 'stay',
    icon: 'dollar',
  },
]
