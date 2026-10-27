import type { Match, Team } from './data'

export type Standing = {
  team: Team
  played: number
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  points: number
  yellowCards: number
  redCards: number
  fairPlay: number
  form: Array<'W' | 'D' | 'L'>
  headToHeadPoints: number
  headToHeadGoalDifference: number
  headToHeadGoals: number
  position: number
  tieUnresolved: boolean
  groupComplete: boolean
}

function goalsFor(match: Match, team: string) {
  return match.home_team === team ? match.home_score : match.away_score
}

function goalsAgainst(match: Match, team: string) {
  return match.home_team === team ? match.away_score : match.home_score
}

function fairPlay(match: Match, team: string) {
  return match.home_team === team ? match.home_fair_play_score : match.away_fair_play_score
}

function compare(a: Standing, b: Standing) {
  return b.points - a.points
    || b.headToHeadPoints - a.headToHeadPoints
    || b.headToHeadGoalDifference - a.headToHeadGoalDifference
    || b.headToHeadGoals - a.headToHeadGoals
    || (b.goalsFor - b.goalsAgainst) - (a.goalsFor - a.goalsAgainst)
    || b.goalsFor - a.goalsFor
    || b.fairPlay - a.fairPlay
}

export function buildStandings(teams: Team[], matches: Match[]) {
  return ['A', 'B', 'C', 'D'].map(group => {
    const groupTeams = teams.filter(team => team.group_name === group)
    const fixtures = matches.filter(match => match.stage === 'group' && match.group_name === group)
    const completed = fixtures.filter(match => match.status === 'final')
    const rows = groupTeams.map(team => {
      const formMatches = completed.filter(match => match.home_team === team.name || match.away_team === team.name)
      const row: Standing = {
        team, played: formMatches.length, won: 0, drawn: 0, lost: 0,
        goalsFor: 0, goalsAgainst: 0, points: 0,
        yellowCards: 0, redCards: 0, fairPlay: 0,
        form: formMatches.slice(-5).map(match => goalsFor(match, team.name) > goalsAgainst(match, team.name) ? 'W' : goalsFor(match, team.name) === goalsAgainst(match, team.name) ? 'D' : 'L'),
        headToHeadPoints: 0, headToHeadGoalDifference: 0, headToHeadGoals: 0,
        position: 0, tieUnresolved: false, groupComplete: fixtures.length >= 6 && completed.length === fixtures.length,
      }
      for (const match of formMatches) {
        const gf = goalsFor(match, team.name)
        const ga = goalsAgainst(match, team.name)
        row.goalsFor += gf
        row.goalsAgainst += ga
        row.yellowCards += (match.home_team === team.name ? match.home_yellow_cards : match.away_yellow_cards) ?? 0
        row.redCards += (match.home_team === team.name ? match.home_red_cards : match.away_red_cards) ?? 0
        row.fairPlay += fairPlay(match, team.name) ?? 0
        if (gf > ga) { row.won++; row.points += 3 }
        else if (gf === ga) { row.drawn++; row.points++ }
        else row.lost++
      }
      return row
    })

    // Apply FIFA's head-to-head criteria among teams tied on points, then overall GD/GF and fair play.
    for (const row of rows) {
      const tiedNames = new Set(rows.filter(other => other.points === row.points).map(other => other.team.name))
      for (const match of completed) {
        if (tiedNames.has(match.home_team) && tiedNames.has(match.away_team) && (match.home_team === row.team.name || match.away_team === row.team.name)) {
          const gf = goalsFor(match, row.team.name)
          const ga = goalsAgainst(match, row.team.name)
          row.headToHeadGoals += gf
          row.headToHeadGoalDifference += gf - ga
          row.headToHeadPoints += gf > ga ? 3 : gf === ga ? 1 : 0
        }
      }
    }
    rows.sort(compare)
    rows.forEach((row, index) => {
      const previous = rows[index - 1]
      row.position = previous && compare(previous, row) === 0 ? previous.position : index + 1
      row.tieUnresolved = rows.some(other => other !== row && compare(other, row) === 0)
    })
    return { group, rows, fixtures: fixtures.length, completed: completed.length }
  })
}
