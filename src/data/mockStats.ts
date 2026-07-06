import type { Stat } from '../types'

export const stats: Stat[] = [
  {
    id: 'trips',
    label: 'Total trips',
    value: '12',
    helper: '+2 this month',
    helperTone: 'positive',
    tone: 'brand',
    icon: 'compass',
  },
  {
    id: 'days',
    label: 'Days planned',
    value: '84',
    helper: 'Across all trips',
    helperTone: 'neutral',
    tone: 'culture',
    icon: 'calendar',
  },
  {
    id: 'places',
    label: 'Places saved',
    value: '247',
    helper: '+18 this week',
    helperTone: 'positive',
    tone: 'coral',
    icon: 'pin',
  },
  {
    id: 'budget',
    label: 'Total budget',
    value: '$24.8k',
    helper: 'Across all trips',
    helperTone: 'neutral',
    tone: 'stay',
    icon: 'dollar',
  },
]
