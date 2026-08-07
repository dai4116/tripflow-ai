import type { Trip } from '../types'
import { formatDateRange, toDateInputValue } from './generateTrip.ts'

// Seed trips need a startDate that's still in the future for the dashboard's
// "upcoming trip" spotlight (see DashboardPage.vue's daysUntil filter) to
// have anything to show — anchoring to today instead of a fixed calendar
// date keeps this demo data from silently going stale as time passes.
function tripDates(offsetDays: number, days: number): { startDate: string; dateRange: string } {
  const start = new Date()
  start.setDate(start.getDate() + offsetDays)
  const startDate = toDateInputValue(start)

  const end = new Date(start)
  end.setDate(end.getDate() + (days - 1))

  return { startDate, dateRange: formatDateRange(startDate, toDateInputValue(end)) }
}

export const trips: Trip[] = [
  {
    id: 'tokyo-explorer',
    title: '東京探索之旅',
    destination: '東京，日本',
    days: 8,
    travelers: 2,
    placeCount: 18,
    color: '#2e9e62',
    ...tripDates(49, 8),
    preferences: ['博物館', '在地美食', '建築'],
    pace: 'balanced',
    columns: [
      { id: 'day-1', dayNumber: 1, title: '第1天', placeIds: ['ana-flight', 'shinjuku-hotel', 'tsukiji', 'ueno', 'asakusa', 'sensoji'] },
      { id: 'day-2', dayNumber: 2, title: '第2天', placeIds: ['shibuya', 'meiji', 'harajuku', 'gyoen'] },
      { id: 'day-3', dayNumber: 3, title: '第3天', placeIds: ['akihabara', 'odaiba'] },
    ],
  },
  {
    id: 'santorini-escape',
    title: '聖托里尼度假之旅',
    destination: '聖托里尼，希臘',
    days: 8,
    travelers: 2,
    placeCount: 12,
    color: '#8161e6',
    ...tripDates(97, 8),
    preferences: ['海灘', '攝影'],
    pace: 'relaxed',
    columns: [],
  },
  {
    id: 'bali-retreat',
    title: '峇里島療癒之旅',
    destination: '峇里島，印尼',
    days: 9,
    travelers: 2,
    placeCount: 9,
    color: '#4a7de0',
    ...tripDates(136, 9),
    preferences: ['自然', '咖啡廳'],
    pace: 'relaxed',
    columns: [],
  },
  {
    id: 'paris-weekend',
    title: '巴黎週末小旅行',
    destination: '巴黎，法國',
    days: 4,
    travelers: 2,
    placeCount: 11,
    color: '#c7935b',
    ...tripDates(14, 4),
    preferences: ['博物館', '咖啡廳'],
    pace: 'packed',
    columns: [],
  },
]

export const activeTrip = trips[0]
