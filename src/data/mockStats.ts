import type { Stat } from '../types'

export const stats: Stat[] = [
  { id: 'trips', label: 'Total Trips', value: '12', helper: '+2 this month', tone: 'navy', icon: '✈' },
  { id: 'days', label: 'Days Planned', value: '84', helper: 'Across all trips', tone: 'violet', icon: '▣' },
  { id: 'places', label: 'Places Saved', value: '247', helper: '+18 this week', tone: 'green', icon: '⌖' },
  { id: 'budget', label: 'Total Budget', value: '$24.8k', helper: 'Across all trips', tone: 'gold', icon: '$' },
]
