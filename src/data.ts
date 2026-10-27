export type Match = {
  id: string
  home_team: string
  away_team: string
  home_score: number
  away_score: number
  status: 'upcoming' | 'live' | 'final'
  starts_at: string
  event_day: number
  kickoff_time: string
  group_name: string | null
  stage: string
  venue: string
  version: number
  updated_at: string
}
export type Team = { id: string; name: string; short_name: string; color: string; group_name: string | null; active: boolean }
export type ShowdownEntry = { id: string; operation_id: string; participant_name: string; score: number; created_at: string; updated_at: string }
export function formatKickoff(value: string) { return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value)) }
export function formatTime(value: string) { return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(`1970-01-01T${value}`)) }
export function formatDay(value: string) { return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(value)) }
