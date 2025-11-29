export type CalendarView = 'day' | 'week' | 'month' | 'year'

export type CalendarEvent = {
  id: number
  name: string
  time: string
  datetime: string
  href?: string
  location?: string
}

export type CalendarDay = {
  label?: string
  date: string
  isCurrentMonth?: boolean
  isToday?: boolean
  isSelected?: boolean
  events: CalendarEvent[]
}
