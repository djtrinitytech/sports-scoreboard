import { buildStandings } from './standings'
import type { Match, Team } from './data'
import './points-table.css'

export function PointsTable({ teams, matches }: { teams: Team[]; matches: Match[] }) {
  const groups = buildStandings(teams, matches)
  return <section className="points-board" aria-label="Group points tables">
    <div className="points-heading">
      <div><span className="kicker">GROUP STAGE</span><h2>Points table</h2><p>Standings update from completed group matches. Ties follow FIFA group-stage criteria.</p></div>
      <span className="points-groups">{groups.reduce((count, group) => count + group.rows.length, 0)} TEAMS · 4 GROUPS</span>
    </div>
    <div className="standings-grid">
      {groups.map(({ group, rows, fixtures, completed }) => <section className="standing-group" key={group} aria-label={`Group ${group} points table`}>
        <div className="standing-group-heading"><h3>Group {group}</h3><span>{completed}/{fixtures} played</span></div>
        {rows.length === 0 ? <div className="standings-empty">Group {group} has no teams configured.</div> : <div className="standings-scroll" role="region" aria-label={`Group ${group} standings`} tabIndex={0}>
          <table className="standings-table">
            <thead><tr><th scope="col">Pos</th><th scope="col" className="team-column">Team</th><th scope="col" title="Played">MP</th><th scope="col">W</th><th scope="col">D</th><th scope="col">L</th><th scope="col">GF</th><th scope="col">GA</th><th scope="col">GD</th><th scope="col">Pts</th><th scope="col">Form</th><th scope="col">YC</th><th scope="col">RC</th><th scope="col" title="Fair-play points">FP</th><th scope="col">Status</th><th scope="col">Tie-break</th></tr></thead>
            <tbody>{rows.map(row => {
              const status = row.tieUnresolved ? 'Tie unresolved' : row.groupComplete ? row.position <= 2 ? 'Top 2 · Final' : 'Outside top 2' : row.position <= 2 ? 'Top 2' : 'Chasing'
              return <tr key={row.team.id} className={row.position <= 2 ? 'qualification-place' : ''}>
                <td className="position-cell">{row.position}</td><th scope="row" className="team-column team-name">{row.team.name}</th>
                <td>{row.played}</td><td>{row.won}</td><td>{row.drawn}</td><td>{row.lost}</td><td>{row.goalsFor}</td><td>{row.goalsAgainst}</td><td className="goal-difference">{row.goalsFor - row.goalsAgainst > 0 ? '+' : ''}{row.goalsFor - row.goalsAgainst}</td><td className="points-total">{row.points}</td>
                <td><span className="form-list" aria-label={`Recent form: ${row.form.join(', ') || 'none'}`}>{row.form.length ? row.form.map((result, index) => <i key={`${row.team.id}-${index}`} className={`form-${result.toLowerCase()}`} title={result === 'W' ? 'Win' : result === 'D' ? 'Draw' : 'Loss'}>{result}</i>) : <span className="no-form">—</span>}</span></td>
                <td>{row.yellowCards}</td><td>{row.redCards}</td><td>{row.fairPlay > 0 ? '+' : ''}{row.fairPlay}</td><td><span className={`standing-status ${status.startsWith('Top 2') ? 'qualified' : status === 'Outside top 2' ? 'eliminated' : status === 'Tie unresolved' ? 'tie-pending' : ''}`}>{status}</span></td>
                <td className="tie-detail-cell"><details><summary aria-label={`Tie-break details for ${row.team.name}`}>Details</summary><div className="tie-detail-popover"><b>Head-to-head</b><span>{row.headToHeadPoints} pts · {row.headToHeadGoalDifference > 0 ? '+' : ''}{row.headToHeadGoalDifference} GD · {row.headToHeadGoals} GF</span><small>Among teams currently level on points</small></div></details></td>
              </tr>
            })}</tbody>
          </table>
        </div>}
        <div className="group-progress"><span>{completed} of {fixtures} matches completed</span><span>{rows.length > 0 ? 'Top two places shown' : ''}</span></div>
      </section>)}
    </div>
    <p className="standings-footnote">MP–played · GF/GA–goals for/against · GD–goal difference · Pts–points · YC/RC–yellow/red cards · FP–fair-play points. Fair-play scores and card totals are entered by a Super Admin.</p>
  </section>
}
