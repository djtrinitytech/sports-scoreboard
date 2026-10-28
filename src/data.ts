export type Match = {
  id: string
  home_team: string
  away_team: string
  home_score: number
  away_score: number
  home_yellow_cards: number
  away_yellow_cards: number
  home_red_cards: number
  away_red_cards: number
  home_fair_play_score: number
  away_fair_play_score: number
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
export type KnockoutFixture = { code: string; stage: 'quarterfinal' | 'semifinal' | 'final' | 'third_place'; home_source: string; away_source: string; home_label: string; away_label: string; home_team: string | null; away_team: string | null; match_id: string | null; event_day: number; kickoff_time: string; venue: string; resolution_error: string | null }
export type Team = { id: string; name: string; short_name: string; color: string; group_name: string | null; active: boolean }
export type ShowdownEntry = { id: string; operation_id: string; participant_name: string; score: number; created_at: string; updated_at: string }
export type ShowdownPlayer = { id: string; registration_id: string; full_name: string; college_name: string | null; phone_number: string | null; legacy_points: number; created_at: string }
export type ShowdownMatch = { id: string; player_one_id: string; player_two_id: string; status: 'draft' | 'live' | 'final'; player_one_points: number; player_two_points: number; player_one_goals: number; player_two_goals: number; player_one_pannas: number; player_two_pannas: number; version: number; created_at: string }
export type ShowdownStanding = { player_id: string; registration_id: string; full_name: string; college_name: string | null; played: number; wins: number; draws: number; losses: number; goals: number; pannas: number; legacy_points: number; scored_points: number; tournament_points: number }
export function teamDisplayName(name: string, teams: Team[], showFullName: boolean) {
  const team = teams.find(item => item.name === name)
  return team ? showFullName ? team.name : team.short_name : name
}
export function formatKickoff(value: string) { return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value)) }
export function formatTime(value: string) { return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(`1970-01-01T${value}`)) }
export function formatDay(value: string) { return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(value)) }
