import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Check, CircleHelp, Cloud, Flag, LogIn, LogOut, Minus, Plus, RefreshCw, Shield, ShieldCheck, Wifi, X } from 'lucide-react'
import { createClient } from '@supabase/supabase-js'
import { formatTime, teamDisplayName, type Match, type Team } from './data'
import { PointsTable } from './PointsTable'
import { MaxShowdown } from './MaxShowdown'
import './showdown.css'
import './responsive.css'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const db = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null
type Role = 'admin' | 'super_admin'
type Filter = 'Points Table' | 'All matches' | 'Max Showdown' | 'Live' | 'Upcoming' | 'Final' | 'Group A' | 'Group B' | 'Group C' | 'Group D'
type MatchCorrection = { home_team: string; away_team: string; home_score: string; away_score: string; home_yellow_cards: string; away_yellow_cards: string; home_red_cards: string; away_red_cards: string; home_fair_play_score: string; away_fair_play_score: string; status: Match['status']; event_day: string; kickoff_time: string; venue: string; stage: string }
type MatchCards = Pick<MatchCorrection, 'home_yellow_cards' | 'away_yellow_cards' | 'home_red_cards' | 'away_red_cards' | 'home_fair_play_score' | 'away_fair_play_score'>
const emptyMessage = 'No matches are in the database yet. Apply the official schedule migration to load the groups and fixtures.'

function Crest({ name, teams }: { name: string; teams: Team[] }) {
  const team = teams.find(item => item.name === name)
  return <span className="crest" style={{ backgroundColor: team?.color ?? '#e4e9e3' }}>{team?.short_name.slice(0, 1) ?? '?'}</span>
}

function IconButton({ children, onClick, label }: { children: React.ReactNode; onClick: () => void; label: string }) {
  return <button className="icon-button" onClick={onClick} aria-label={label}>{children}</button>
}

export default function App() {
  const [matches, setMatches] = useState<Match[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [filter, setFilter] = useState<Filter>('Points Table')
  const [panelOpen, setPanelOpen] = useState(false)
  const [passcode, setPasscode] = useState('')
  const [role, setRole] = useState<Role | null>(null)
  const [online, setOnline] = useState(navigator.onLine)
  const [synced, setSynced] = useState(false)
  const [syncFailed, setSyncFailed] = useState(false)
  const [syncPending, setSyncPending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [loginError, setLoginError] = useState('')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')
  const [fixture, setFixture] = useState({ home_team: '', away_team: '', event_day: 1, kickoff_time: '', venue: '' })
  const [editingMatchId, setEditingMatchId] = useState<string | null>(null)
  const [editingCardsId, setEditingCardsId] = useState<string | null>(null)
  const [cardCorrection, setCardCorrection] = useState<MatchCards>({ home_yellow_cards: '0', away_yellow_cards: '0', home_red_cards: '0', away_red_cards: '0', home_fair_play_score: '0', away_fair_play_score: '0' })
  const [matchCorrection, setMatchCorrection] = useState<MatchCorrection>({ home_team: '', away_team: '', home_score: '0', away_score: '0', home_yellow_cards: '0', away_yellow_cards: '0', home_red_cards: '0', away_red_cards: '0', home_fair_play_score: '0', away_fair_play_score: '0', status: 'upcoming', event_day: '1', kickoff_time: '', venue: '', stage: 'group' })
  const scoreActionLock = useRef(false)
  const admin = role !== null
  const superAdmin = role === 'super_admin'
  const announce = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2800) }

  const refresh = useCallback(async (quiet = false) => {
    if (!db) { setError('Supabase is not configured. Add the project URL and publishable key to .env.local.'); setLoading(false); return }
    if (!navigator.onLine) { setOnline(false); setLoading(false); return }
    const [matchResult, teamResult] = await Promise.all([
      db.from('matches').select('*').order('event_day', { ascending: true }).order('kickoff_time', { ascending: true }),
      db.from('teams').select('*').eq('active', true).order('group_name', { ascending: true }).order('name', { ascending: true }),
    ])
    const problem = matchResult.error ?? teamResult.error
    if (problem) {
      setError(problem.message); setSyncFailed(true); setSynced(false); setLoading(false)
      if (!quiet) announce(`Database error: ${problem.message}`)
      return
    }
    setMatches((matchResult.data ?? []) as Match[])
    setTeams((teamResult.data ?? []) as Team[])
    setError(''); setSyncFailed(false); setSynced(true); setOnline(true); setLoading(false)
  }, [])

  useEffect(() => {
    void refresh(true)
    const onOnline = () => { setOnline(true); void refresh(true) }
    const onOffline = () => { setOnline(false); setSynced(false) }
    window.addEventListener('online', onOnline); window.addEventListener('offline', onOffline)
    if (!db) return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline) }
    const channel = db.channel('touchline-matches')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => { void refresh(true) })
      .subscribe(status => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { setSyncFailed(true); setSynced(false) }
    })
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); void db?.removeChannel(channel) }
  }, [refresh])

  async function callAdmin(payload: Record<string, unknown>) {
    const response = await fetch('/api/admin-panel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, passcode }),
    })
    const result = await response.json().catch(() => ({})) as { error?: string; role?: Role; data?: unknown }
    if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status})`)
    return result
  }

  const filtered = useMemo(() => matches.filter(match => {
    if (filter === 'Max Showdown' || filter === 'Points Table') return false
    if (filter === 'All matches') return true
    if (filter === 'Live') return match.status === 'live'
    if (filter === 'Upcoming') return match.status === 'upcoming'
    if (filter === 'Final') return match.status === 'final'
    return match.group_name === filter.slice(-1)
  }), [matches, filter])
  const liveCount = matches.filter(match => match.status === 'live').length
  const stateLabel = !online ? 'Connection Unstable' : syncFailed ? 'Sync Failed' : syncPending ? 'Pending Sync' : synced ? 'Synced' : 'Online'

  async function signIn(event: React.FormEvent) {
    event.preventDefault(); setLoginError(''); setBusy(true)
    try {
      const result = await callAdmin({ mode: 'verify' })
      if (result.role !== 'admin' && result.role !== 'super_admin') throw new Error('The server returned an invalid access role.')
      setRole(result.role); announce(result.role === 'super_admin' ? 'Super admin access enabled' : 'Admin access enabled')
    } catch (err) { setLoginError(err instanceof Error ? err.message : 'Access could not be verified.') }
    finally { setBusy(false) }
  }

  function signOut() { setRole(null); setPasscode(''); setPanelOpen(false); announce('Admin access closed') }

  async function changeMatch(match: Match, action: 'goal' | 'undo' | 'status', payload: Record<string, unknown>) {
    if (!admin || busy || scoreActionLock.current) return
    const optimistic: Match = { ...match, version: match.version + 1 }
    if (action === 'goal' || action === 'undo') {
      if (payload.team === match.home_team) optimistic.home_score = match.home_score + (action === 'goal' ? 1 : -1)
      else if (payload.team === match.away_team) optimistic.away_score = match.away_score + (action === 'goal' ? 1 : -1)
    } else optimistic.status = payload.status as Match['status']
    setMatches(current => current.map(item => item.id === match.id ? optimistic : item))
    scoreActionLock.current = true; setBusy(true); setSyncPending(true)
    try {
      const result = await callAdmin({ mode: 'score', operation_id: crypto.randomUUID(), match_id: match.id, action_type: action, payload: { ...payload, expected_version: match.version } })
      const saved = result.data as Match
      setMatches(current => current.map(item => item.id === match.id ? saved : item)); announce('Score saved · Synced')
    } catch (err) {
      setMatches(current => current.map(item => item.id === match.id ? match : item))
      setSyncFailed(true); setSynced(false)
      const message = err instanceof Error ? err.message : 'Server did not confirm the score.'
      announce(message.toLowerCase().includes('version conflict') ? 'This match changed elsewhere. Refreshed the server score.' : `Sync Failed · ${message}`)
      await refresh(true)
    } finally { scoreActionLock.current = false; setSyncPending(false); setBusy(false) }
  }

  function beginMatchCorrection(match: Match) {
    setEditingMatchId(match.id)
    setMatchCorrection({ home_team: match.home_team, away_team: match.away_team, home_score: String(match.home_score), away_score: String(match.away_score), home_yellow_cards: String(match.home_yellow_cards ?? 0), away_yellow_cards: String(match.away_yellow_cards ?? 0), home_red_cards: String(match.home_red_cards ?? 0), away_red_cards: String(match.away_red_cards ?? 0), home_fair_play_score: String(match.home_fair_play_score ?? 0), away_fair_play_score: String(match.away_fair_play_score ?? 0), status: match.status, event_day: String(match.event_day ?? 1), kickoff_time: match.kickoff_time ?? '', venue: match.venue, stage: match.stage || 'group' })
  }

  async function saveMatchCorrection(event: React.FormEvent) {
    event.preventDefault()
    const match = matches.find(item => item.id === editingMatchId)
    if (!superAdmin || !match || busy) return
    setBusy(true); setSyncPending(true)
    try {
      await callAdmin({ mode: 'match_edit', match_id: match.id, expected_version: match.version, ...matchCorrection, home_score: Number(matchCorrection.home_score), away_score: Number(matchCorrection.away_score), home_yellow_cards: Number(matchCorrection.home_yellow_cards), away_yellow_cards: Number(matchCorrection.away_yellow_cards), home_red_cards: Number(matchCorrection.home_red_cards), away_red_cards: Number(matchCorrection.away_red_cards), home_fair_play_score: Number(matchCorrection.home_fair_play_score), away_fair_play_score: Number(matchCorrection.away_fair_play_score), event_day: Number(matchCorrection.event_day) })
      setEditingMatchId(null); await refresh(true); announce('Match details corrected · Synced')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'server error'
      announce(message.toLowerCase().includes('version conflict') ? 'Match changed elsewhere. Refresh and retry the correction.' : `Could not correct match: ${message}`)
      await refresh(true)
    } finally { setSyncPending(false); setBusy(false) }
  }

  function beginCardCorrection(match: Match) {
    setEditingCardsId(match.id)
    setCardCorrection({ home_yellow_cards: String(match.home_yellow_cards ?? 0), away_yellow_cards: String(match.away_yellow_cards ?? 0), home_red_cards: String(match.home_red_cards ?? 0), away_red_cards: String(match.away_red_cards ?? 0), home_fair_play_score: String(match.home_fair_play_score ?? 0), away_fair_play_score: String(match.away_fair_play_score ?? 0) })
  }

  async function saveMatchCards(event: React.FormEvent) {
    event.preventDefault()
    const match = matches.find(item => item.id === editingCardsId)
    if (!admin || !match || busy) return
    const previous = match
    const optimistic = { ...match, ...Object.fromEntries(Object.entries(cardCorrection).map(([key, value]) => [key, Number(value)])) } as Match
    setMatches(current => current.map(item => item.id === match.id ? optimistic : item)); setBusy(true); setSyncPending(true)
    try {
      const result = await callAdmin({ mode: 'match_cards', match_id: match.id, expected_version: match.version, ...Object.fromEntries(Object.entries(cardCorrection).map(([key, value]) => [key, Number(value)])) })
      const saved = result.data as Match
      setMatches(current => current.map(item => item.id === match.id ? saved : item)); setEditingCardsId(null); announce('Cards corrected · Synced')
    } catch (err) {
      setMatches(current => current.map(item => item.id === match.id ? previous : item)); announce(`Could not update cards: ${err instanceof Error ? err.message : 'server error'}`); await refresh(true)
    } finally { setSyncPending(false); setBusy(false) }
  }

  async function createFixture(event: React.FormEvent) {
    event.preventDefault()
    if (!superAdmin || busy) return
    setBusy(true)
    try {
      await callAdmin({ mode: 'create_match', fixture })
      setFixture({ home_team: '', away_team: '', event_day: 1, kickoff_time: '', venue: '' })
      await refresh(true); announce('Fixture added · Synced')
    } catch (err) { announce(`Could not add fixture: ${err instanceof Error ? err.message : 'server error'}`) }
    finally { setBusy(false) }
  }

  return <div className="board-shell">
    <header className="board-header">
      <div className="board-brand"><span className="board-mark"><Activity size={20} /></span><span>VYUHA <small>LIVE SCORES</small></span><img className="trinity-logo" src="/trinity-logo.webp" alt="Trinity" /></div>
      <div className={`connection-pill ${syncFailed || !online ? 'warning' : ''}`}><span className="connection-dot" />{stateLabel}</div>
      <button className="admin-open" onClick={() => { setPanelOpen(true); setLoginError('') }}>{admin ? <><ShieldCheck size={17} /> Admin panel</> : <><LogIn size={17} /> Admin</>}</button>
    </header>
    <main className="board-content">
      <div className="board-title-row"><div><div className="kicker">COMMUNITY LEAGUE</div><h1>Live <span>scoreboard</span></h1><p>Live scores, upcoming fixtures and final results from the league.</p></div><button className="refresh-button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={16} className={loading ? 'spin' : ''} /> Refresh</button></div>
      <div className="board-status-row"><div className="live-indicator"><i /> {liveCount} LIVE {liveCount === 1 ? 'MATCH' : 'MATCHES'}</div><button className="showdown-shortcut" onClick={() => setFilter('Max Showdown')}>Max Showdown <span>PLAYER STANDINGS</span></button><span>{synced ? <><Wifi size={14} /> Last checked {new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</> : <><Cloud size={14} /> Waiting for server confirmation</>}</span></div>
      {error && <div className="error-banner"><CircleHelp size={18} /><div><b>Could not load league data</b><span>{error}</span>{error.includes('relation') && <span>Apply the SQL migrations in Supabase, then refresh.</span>}</div><button onClick={() => void refresh()}>Retry</button></div>}
      <div className="filter-bar">{(['Points Table', 'All matches', 'Max Showdown', 'Live', 'Upcoming', 'Final', 'Group A', 'Group B', 'Group C', 'Group D'] as Filter[]).map(item => <button key={item} className={filter === item ? 'selected' : ''} onClick={() => setFilter(item)}>{item}{item === 'Live' && liveCount > 0 && <i>{liveCount}</i>}</button>)}<span className="match-total">{filter === 'Points Table' ? '4 GROUPS' : filter === 'Max Showdown' ? 'MAX SHOWDOWN' : `${filtered.length} MATCHES`}</span></div>
      {filter === 'Points Table' ? loading ? <div className="board-empty"><RefreshCw className="spin" size={20} />Loading points table from Supabase…</div> : <PointsTable teams={teams} matches={matches} showFullNames={admin} /> : filter === 'Max Showdown' ? <MaxShowdown role={role} passcode={passcode} db={db} onAdminLogin={() => { setPanelOpen(true); setLoginError('') }} /> : <section className="match-board" aria-label="League matches">{loading ? <div className="board-empty"><RefreshCw className="spin" size={20} />Loading scores from Supabase…</div> : filtered.length === 0 ? <div className="board-empty"><Shield size={22} /><b>{matches.length === 0 ? emptyMessage : 'No matches in this filter.'}</b></div> : filtered.map(match => <article className={`match-row ${match.status === 'live' ? 'row-live' : ''}`} key={match.id}>
        <div className="match-meta"><span className={`status-label ${match.status}`}>{match.status === 'live' && <i />}{match.status === 'final' ? 'FINAL' : match.status === 'live' ? 'LIVE' : 'UPCOMING'}</span><span>DAY {match.event_day} · {formatTime(match.kickoff_time)}</span>{match.group_name && <span className="group-tag">GROUP {match.group_name}</span>}<span className="venue-label">{match.venue}</span></div>
        <div className="match-scoreline"><div className="match-team"><Crest name={match.home_team} teams={teams} /><b>{teamDisplayName(match.home_team, teams, admin)}</b></div><strong className="score-value">{match.status === 'upcoming' ? <span className="versus">VS</span> : <>{match.home_score}<em>:</em>{match.away_score}</>}</strong><div className="match-team away"><Crest name={match.away_team} teams={teams} /><b>{teamDisplayName(match.away_team, teams, admin)}</b></div></div>
        {admin && <div className="score-edit">
          <div className="score-side"><span>{teams.find(team => team.name === match.home_team)?.short_name}</span><button disabled={busy || (match.status === 'final' && !superAdmin) || match.home_score === 0} onClick={() => void changeMatch(match, 'undo', { team: match.home_team })} aria-label={`Subtract goal from ${match.home_team}`}><Minus size={17} /></button><button className="plus-score" disabled={busy || (match.status === 'final' && !superAdmin)} onClick={() => void changeMatch(match, 'goal', { team: match.home_team })} aria-label={`Add goal for ${match.home_team}`}><Plus size={17} /></button></div>
          <span className="edit-caption">EDIT SCORE</span>
          <div className="score-side"><button disabled={busy || (match.status === 'final' && !superAdmin) || match.away_score === 0} onClick={() => void changeMatch(match, 'undo', { team: match.away_team })} aria-label={`Subtract goal from ${match.away_team}`}><Minus size={17} /></button><button className="plus-score" disabled={busy || (match.status === 'final' && !superAdmin)} onClick={() => void changeMatch(match, 'goal', { team: match.away_team })} aria-label={`Add goal for ${match.away_team}`}><Plus size={17} /></button><span>{teams.find(team => team.name === match.away_team)?.short_name}</span></div>
          <div className="status-actions"><button onClick={() => beginCardCorrection(match)} disabled={busy}>Edit cards</button>{match.status !== 'live' && <button onClick={() => void changeMatch(match, 'status', { status: 'live' })} disabled={busy}>Start</button>}{match.status !== 'final' && <button onClick={() => void changeMatch(match, 'status', { status: 'final' })} disabled={busy}><Flag size={13} /> Final</button>}{superAdmin && match.status === 'final' && <button onClick={() => void changeMatch(match, 'status', { status: 'live' })} disabled={busy}>Reopen</button>}{superAdmin && <button onClick={() => beginMatchCorrection(match)} disabled={busy}>Edit all</button>}</div>
        </div>}
        {admin && editingCardsId === match.id && <form className="match-correction-form match-card-form" onSubmit={event => void saveMatchCards(event)}>
          <h3>Cards &amp; fair play · Any match status</h3>
          <label>Home yellow cards<input required type="number" min="0" step="1" value={cardCorrection.home_yellow_cards} onChange={event => setCardCorrection({ ...cardCorrection, home_yellow_cards: event.target.value })} /></label>
          <label>Away yellow cards<input required type="number" min="0" step="1" value={cardCorrection.away_yellow_cards} onChange={event => setCardCorrection({ ...cardCorrection, away_yellow_cards: event.target.value })} /></label>
          <label>Home red cards<input required type="number" min="0" step="1" value={cardCorrection.home_red_cards} onChange={event => setCardCorrection({ ...cardCorrection, home_red_cards: event.target.value })} /></label>
          <label>Away red cards<input required type="number" min="0" step="1" value={cardCorrection.away_red_cards} onChange={event => setCardCorrection({ ...cardCorrection, away_red_cards: event.target.value })} /></label>
          <label>Home fair-play points<input required type="number" step="1" value={cardCorrection.home_fair_play_score} onChange={event => setCardCorrection({ ...cardCorrection, home_fair_play_score: event.target.value })} /></label>
          <label>Away fair-play points<input required type="number" step="1" value={cardCorrection.away_fair_play_score} onChange={event => setCardCorrection({ ...cardCorrection, away_fair_play_score: event.target.value })} /></label>
          <div className="match-correction-actions"><button className="entry-save" disabled={busy}>{busy ? 'Saving…' : 'Save card update'}</button><button type="button" className="entry-cancel" onClick={() => setEditingCardsId(null)}>Cancel</button></div>
        </form>}
        {superAdmin && editingMatchId === match.id && <form className="match-correction-form" onSubmit={event => void saveMatchCorrection(event)}>
          <h3>Super Admin · Edit match</h3>
          <label>Home team<select required value={matchCorrection.home_team} onChange={event => setMatchCorrection({ ...matchCorrection, home_team: event.target.value })}>{teams.map(team => <option key={team.id} value={team.name}>{team.name}</option>)}</select></label>
          <label>Away team<select required value={matchCorrection.away_team} onChange={event => setMatchCorrection({ ...matchCorrection, away_team: event.target.value })}>{teams.map(team => <option key={team.id} value={team.name}>{team.name}</option>)}</select></label>
          <label>Home score<input required type="number" min="0" step="1" value={matchCorrection.home_score} onChange={event => setMatchCorrection({ ...matchCorrection, home_score: event.target.value })} /></label>
          <label>Away score<input required type="number" min="0" step="1" value={matchCorrection.away_score} onChange={event => setMatchCorrection({ ...matchCorrection, away_score: event.target.value })} /></label>
          <label>Home yellow cards<input required type="number" min="0" step="1" value={matchCorrection.home_yellow_cards} onChange={event => setMatchCorrection({ ...matchCorrection, home_yellow_cards: event.target.value })} /></label>
          <label>Away yellow cards<input required type="number" min="0" step="1" value={matchCorrection.away_yellow_cards} onChange={event => setMatchCorrection({ ...matchCorrection, away_yellow_cards: event.target.value })} /></label>
          <label>Home red cards<input required type="number" min="0" step="1" value={matchCorrection.home_red_cards} onChange={event => setMatchCorrection({ ...matchCorrection, home_red_cards: event.target.value })} /></label>
          <label>Away red cards<input required type="number" min="0" step="1" value={matchCorrection.away_red_cards} onChange={event => setMatchCorrection({ ...matchCorrection, away_red_cards: event.target.value })} /></label>
          <label>Home fair-play points<input required type="number" step="1" value={matchCorrection.home_fair_play_score} onChange={event => setMatchCorrection({ ...matchCorrection, home_fair_play_score: event.target.value })} /></label>
          <label>Away fair-play points<input required type="number" step="1" value={matchCorrection.away_fair_play_score} onChange={event => setMatchCorrection({ ...matchCorrection, away_fair_play_score: event.target.value })} /></label>
          <label>Status<select value={matchCorrection.status} onChange={event => setMatchCorrection({ ...matchCorrection, status: event.target.value as Match['status'] })}><option value="upcoming">Upcoming</option><option value="live">Live</option><option value="final">Final</option></select></label>
          <label>Day<input required type="number" min="1" max="32767" step="1" value={matchCorrection.event_day} onChange={event => setMatchCorrection({ ...matchCorrection, event_day: event.target.value })} /></label>
          <label>Kickoff<input required type="time" value={matchCorrection.kickoff_time} onChange={event => setMatchCorrection({ ...matchCorrection, kickoff_time: event.target.value })} /></label>
          <label>Venue<input required maxLength={120} value={matchCorrection.venue} onChange={event => setMatchCorrection({ ...matchCorrection, venue: event.target.value })} /></label>
          <label>Stage<input required maxLength={40} value={matchCorrection.stage} onChange={event => setMatchCorrection({ ...matchCorrection, stage: event.target.value })} /></label>
          <div className="match-correction-actions"><button className="entry-save" disabled={busy}>{busy ? 'Saving…' : 'Save all changes'}</button><button type="button" className="entry-cancel" onClick={() => setEditingMatchId(null)}>Cancel</button></div>
        </form>}
      </article>)}</section>}
      {!admin && filter !== 'Max Showdown' && <div className="readonly-note"><Shield size={15} /> Public scoreboard · read only</div>}
      <footer className="board-footer">VYUHA · LIVE LEAGUE DATA <span>{synced ? <><Check size={13} /> SYNCED WITH SUPABASE</> : stateLabel.toUpperCase()}</span></footer>
    </main>
    {panelOpen && <div className="panel-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setPanelOpen(false) }}><aside className="admin-panel" role="dialog" aria-modal="true" aria-label="Admin panel">
      <div className="panel-header"><div><span className="panel-symbol"><ShieldCheck size={19} /></span><span><b>Admin panel</b><small>Score and access controls</small></span></div><IconButton label="Close panel" onClick={() => setPanelOpen(false)}><X size={20} /></IconButton></div>
      {admin ? <><div className="account-strip"><div className="account-icon">{superAdmin ? <ShieldCheck size={20} /> : <Shield size={20} />}</div><span><b>{superAdmin ? 'Super admin access' : 'Admin access'}</b><small>Shared passcode verified</small></span><button onClick={signOut} aria-label="Sign out"><LogOut size={17} /></button></div>
        <div className="panel-section"><h2>Scoreboard controls</h2><p>Use +1 or undo beside any match. Changes save directly to Supabase.</p><button className="panel-action" onClick={() => { setPanelOpen(false); window.scrollTo({ top: 400, behavior: 'smooth' }) }}>Go to matches</button></div>
        {superAdmin && <div className="panel-section"><h2>Add a group fixture</h2><form className="fixture-form" onSubmit={event => void createFixture(event)}><label>Home team<select required value={fixture.home_team} onChange={event => setFixture({ ...fixture, home_team: event.target.value })}><option value="">Choose team</option>{teams.map(team => <option key={team.id} value={team.name}>{team.name}</option>)}</select></label><label>Away team<select required value={fixture.away_team} onChange={event => setFixture({ ...fixture, away_team: event.target.value })}><option value="">Choose team</option>{teams.filter(team => team.name !== fixture.home_team).map(team => <option key={team.id} value={team.name}>{team.name}</option>)}</select></label><label>Day<select value={fixture.event_day} onChange={event => setFixture({ ...fixture, event_day: Number(event.target.value) })}><option value={1}>Day 1</option><option value={2}>Day 2</option></select></label><label>Kickoff time<input type="time" required value={fixture.kickoff_time} onChange={event => setFixture({ ...fixture, kickoff_time: event.target.value })} /></label><label>Turf<input required value={fixture.venue} onChange={event => setFixture({ ...fixture, venue: event.target.value })} placeholder="Turf 1" /></label><button className="panel-action" disabled={busy || teams.length < 2}>Add fixture</button></form></div>}
        <div className="panel-help">{superAdmin ? 'Super admin can directly edit match scores and details, correct Max Showdown entries, add fixtures, and manage match states.' : 'Admins can update scores and match status. Direct corrections and finalized scores require super admin access.'}</div>
      </> : <><div className="panel-intro"><div className="panel-symbol"><ShieldCheck size={21} /></div><h2>Admin access</h2><p>Enter the admin or super admin passcode.</p></div><form className="login-form" onSubmit={event => void signIn(event)}><label>Passcode<input type="password" autoComplete="current-password" required value={passcode} onChange={event => setPasscode(event.target.value)} /></label>{loginError && <p className="form-error" role="alert">{loginError}</p>}<button className="panel-action" disabled={busy}>{busy ? 'Checking…' : 'Continue'}</button></form></>}
    </aside></div>}
    {toast && <div className="toast"><Check size={16} />{toast}</div>}
  </div>
}
