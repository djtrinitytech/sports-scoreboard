import { useEffect, useMemo, useState } from 'react'
import { Check, Flag, Plus, Search, Shield, UserPlus } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ShowdownMatch, ShowdownPlayer, ShowdownStanding } from './data'
import './showdown.css'

type Role = 'admin' | 'super_admin'
type MatchRow = ShowdownMatch & { pending?: boolean }
type ApiResult = { error?: string; data?: unknown; players?: ShowdownPlayer[]; matches?: ShowdownMatch[] }
type StandingRow = ShowdownStanding & { pending?: boolean }
type Correction = { player_one_points: string; player_two_points: string; player_one_goals: string; player_two_goals: string; player_one_pannas: string; player_two_pannas: string; status: ShowdownMatch['status'] }
type PlayerCorrection = { full_name: string; college_name: string; phone_number: string }

function playerStats(players: ShowdownPlayer[], matches: ShowdownMatch[]): ShowdownStanding[] {
  return players.map(player => {
    const played = matches.filter(match => match.status === 'final' && (match.player_one_id === player.id || match.player_two_id === player.id))
    const stats = played.reduce((result, match) => {
      const one = match.player_one_id === player.id
      const own = one ? match.player_one_points : match.player_two_points
      const other = one ? match.player_two_points : match.player_one_points
      result.played++
      if (own > other) { result.wins++; result.tournament_points += 2 }
      else if (own === other) { result.draws++; result.tournament_points++ }
      else result.losses++
      result.goals += one ? match.player_one_goals : match.player_two_goals
      result.pannas += one ? match.player_one_pannas : match.player_two_pannas
      result.scored_points += own
      return result
    }, { played: 0, wins: 0, draws: 0, losses: 0, goals: 0, pannas: 0, scored_points: player.legacy_points, tournament_points: 0 })
    return { player_id: player.id, registration_id: player.registration_id, full_name: player.full_name, college_name: player.college_name, legacy_points: player.legacy_points, ...stats }
  }).sort((a, b) => b.tournament_points - a.tournament_points || b.scored_points - a.scored_points || b.wins - a.wins || a.full_name.localeCompare(b.full_name))
}

function PlayerPicker({ label, players, value, onChange, excluded }: { label: string; players: ShowdownPlayer[]; value: string; onChange: (player: ShowdownPlayer | null) => void; excluded?: string }) {
  const [query, setQuery] = useState('')
  const selected = players.find(player => player.id === value)
  const filtered = players.filter(player => !player.id.startsWith('pending-') && player.id !== excluded && `${player.full_name} ${player.registration_id} ${player.college_name ?? ''}`.toLowerCase().includes(query.toLowerCase())).slice(0, 6)
  return <div className="showdown-player-picker">
    <label>{label}<span className="showdown-search"><Search size={15} /><input value={selected ? `${selected.full_name} · ${selected.registration_id}` : query} onChange={event => { if (selected) onChange(null); setQuery(event.target.value) }} placeholder="Search registered players" /></span></label>
    {!selected && query && <div className="showdown-search-results">{filtered.map(player => <button type="button" key={player.id} onClick={() => { onChange(player); setQuery('') }}><b>{player.full_name}</b><small>{player.registration_id}{player.college_name ? ` · ${player.college_name}` : ''}</small></button>)}{filtered.length === 0 && <span>No players found.</span>}</div>}
    {selected && <button className="showdown-picked" type="button" onClick={() => onChange(null)}><Check size={15} /> Selected · tap to change</button>}
  </div>
}

export function MaxShowdown({ role, passcode, db, onAdminLogin }: { role: Role | null; passcode: string; db: SupabaseClient | null; onAdminLogin: () => void }) {
  const [standings, setStandings] = useState<StandingRow[]>([])
  const [players, setPlayers] = useState<ShowdownPlayer[]>([])
  const [matches, setMatches] = useState<MatchRow[]>([])
  const [activeTab, setActiveTab] = useState<'registration' | 'tracking'>('registration')
  const [fullName, setFullName] = useState('')
  const [collegeName, setCollegeName] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [playerSearch, setPlayerSearch] = useState('')
  const [editingPlayer, setEditingPlayer] = useState('')
  const [playerCorrection, setPlayerCorrection] = useState<PlayerCorrection>({ full_name: '', college_name: '', phone_number: '' })
  const [fixtureOne, setFixtureOne] = useState('')
  const [fixtureTwo, setFixtureTwo] = useState('')
  const [editingMatch, setEditingMatch] = useState('')
  const [correction, setCorrection] = useState<Correction>({ player_one_points: '0', player_two_points: '0', player_one_goals: '0', player_two_goals: '0', player_one_pannas: '0', player_two_pannas: '0', status: 'draft' })
  const [saving, setSaving] = useState(false)
  const [savingMatch, setSavingMatch] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [lastUpdated, setLastUpdated] = useState('')
  const [filter, setFilter] = useState<'all' | 'draft' | 'live' | 'final'>('all')

  async function refreshPublic() {
    if (!db) { setError('Supabase is not configured.'); return }
    const { data, error: readError } = await db.rpc('get_max_showdown_standings')
    if (readError) { setError(readError.message); return }
    setStandings((data ?? []) as StandingRow[])
    setError('')
    setLastUpdated(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
  }

  async function callAdmin(payload: Record<string, unknown>): Promise<ApiResult> {
    const response = await fetch('/api/admin-panel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, passcode }) })
    const result = await response.json().catch(() => ({})) as ApiResult
    if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status})`)
    return result
  }

  async function refreshAdmin() {
    if (!role) return
    const result = await callAdmin({ mode: 'showdown_admin_data' })
    const nextPlayers = result.players ?? []
    const nextMatches = result.matches ?? []
    setPlayers(nextPlayers)
    setMatches(nextMatches)
    setStandings(playerStats(nextPlayers, nextMatches))
    setError('')
    setLastUpdated(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
  }

  useEffect(() => {
    void refreshPublic()
    if (!db) return
    const channel = db.channel('max-showdown-standings')
      .on('broadcast', { event: 'standings_changed' }, () => { void refreshPublic() })
      .subscribe()
    return () => { void db.removeChannel(channel) }
  }, [db])
  useEffect(() => {
    if (!role) { setPlayers([]); setMatches([]); return }
    void refreshAdmin().catch(err => setError(err instanceof Error ? err.message : 'Could not load admin data.'))
  }, [role, passcode])

  const visiblePlayers = useMemo(() => players.filter(player => `${player.full_name} ${player.registration_id} ${player.college_name ?? ''}`.toLowerCase().includes(playerSearch.toLowerCase())), [players, playerSearch])
  const visibleMatches = useMemo(() => matches.filter(match => filter === 'all' || match.status === filter), [matches, filter])

  async function register(event: React.FormEvent) {
    event.preventDefault()
    if (!role || saving) return
    const optimistic: ShowdownPlayer = { id: `pending-${crypto.randomUUID()}`, registration_id: 'Assigning ID…', full_name: fullName.trim(), college_name: collegeName.trim() || null, phone_number: phoneNumber.trim(), legacy_points: 0, created_at: new Date().toISOString() }
    setPlayers(current => [optimistic, ...current]); setStandings(playerStats([optimistic, ...players], matches)); setSaving(true); setNotice('Saving registration…'); setError('')
    try {
      const result = await callAdmin({ mode: 'showdown_register', full_name: fullName.trim(), college_name: collegeName.trim(), phone_number: phoneNumber.trim() })
      const player = result.data as ShowdownPlayer
      setPlayers(current => current.map(item => item.id === optimistic.id ? player : item))
      setStandings(playerStats([player, ...players], matches))
      setFullName(''); setCollegeName(''); setPhoneNumber(''); setNotice(`${player.registration_id} registered · Synced`)
    } catch (err) { setPlayers(current => current.filter(item => item.id !== optimistic.id)); setStandings(playerStats(players, matches)); setError(err instanceof Error ? err.message : 'Registration failed.'); setNotice('Sync Failed') }
    finally { setSaving(false) }
  }

  function beginPlayerCorrection(player: ShowdownPlayer) {
    setEditingPlayer(player.id)
    setPlayerCorrection({ full_name: player.full_name, college_name: player.college_name ?? '', phone_number: player.phone_number ?? '' })
  }

  async function correctPlayer(event: React.FormEvent, playerId: string) {
    event.preventDefault()
    if (role !== 'super_admin' || saving) return
    setSaving(true); setError(''); setNotice('Saving player correction…')
    try {
      const result = await callAdmin({ mode: 'showdown_player_edit', player_id: playerId, ...playerCorrection })
      const saved = result.data as ShowdownPlayer
      setPlayers(current => current.map(player => player.id === saved.id ? saved : player))
      setStandings(current => current.map(row => row.player_id === saved.id ? { ...row, full_name: saved.full_name, college_name: saved.college_name } : row))
      setEditingPlayer(''); setNotice('Player details corrected · Synced')
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not correct player details.'); setNotice('Sync Failed') }
    finally { setSaving(false) }
  }

  async function createFixture(event: React.FormEvent) {
    event.preventDefault()
    if (!role || !fixtureOne || !fixtureTwo || saving) return
    const one = players.find(player => player.id === fixtureOne)
    const two = players.find(player => player.id === fixtureTwo)
    if (!one || !two || one.id.startsWith('pending-') || two.id.startsWith('pending-') || one.id === two.id) return
    const temporaryId = `pending-${crypto.randomUUID()}`
    const draft: MatchRow = { id: temporaryId, player_one_id: one.id, player_two_id: two.id, status: 'draft', player_one_points: 0, player_two_points: 0, player_one_goals: 0, player_two_goals: 0, player_one_pannas: 0, player_two_pannas: 0, version: 0, created_at: new Date().toISOString(), pending: true }
    setMatches(current => [draft, ...current]); setStandings(playerStats(players, [draft, ...matches])); setFixtureOne(''); setFixtureTwo(''); setSaving(true); setNotice('Saving fixture…'); setError('')
    try {
      const result = await callAdmin({ mode: 'showdown_fixture', player_one_id: one.id, player_two_id: two.id })
      const created = result.data as ShowdownMatch
      setMatches(current => current.map(item => item.id === temporaryId ? created : item)); setNotice('Fixture drafted · Synced')
    } catch (err) { setMatches(current => current.filter(item => item.id !== temporaryId)); setStandings(playerStats(players, matches)); setError(err instanceof Error ? err.message : 'Fixture creation failed.'); setNotice('Sync Failed') }
    finally { setSaving(false) }
  }

  async function setMatchStatus(match: MatchRow, status: 'live' | 'final') {
    if (!role || match.pending || savingMatch) return
    setSavingMatch(match.id); setError(''); setNotice(status === 'live' ? 'Starting match…' : 'Finalizing match…')
    const optimistic: MatchRow = { ...match, status, version: match.version + 1 }
    setMatches(current => current.map(item => item.id === match.id ? optimistic : item)); setStandings(playerStats(players, matches.map(item => item.id === match.id ? optimistic : item)))
    try {
      const result = await callAdmin({ mode: 'showdown_status', match_id: match.id, expected_version: match.version, status })
      const updated = result.data as ShowdownMatch
      setMatches(current => current.map(item => item.id === match.id ? updated : item))
      setStandings(playerStats(players, matches.map(item => item.id === match.id ? updated : item)))
      setNotice(`Match ${status === 'live' ? 'started' : 'finalized'} · Synced`)
    } catch (err) { setError(err instanceof Error ? err.message : 'Match update failed.'); setNotice('Sync Failed'); void refreshAdmin().catch(() => undefined) }
    finally { setSavingMatch('') }
  }

  async function award(match: MatchRow, playerId: string, kind: 'goal' | 'panna') {
    if (!role || match.status !== 'live' || match.pending || savingMatch) return
    const before = match
    const one = playerId === match.player_one_id
    const bump = kind === 'goal' ? 1 : 2
    const updated: MatchRow = { ...match,
      player_one_points: match.player_one_points + (one ? bump : 0), player_two_points: match.player_two_points + (!one ? bump : 0),
      player_one_goals: match.player_one_goals + (one && kind === 'goal' ? 1 : 0), player_two_goals: match.player_two_goals + (!one && kind === 'goal' ? 1 : 0),
      player_one_pannas: match.player_one_pannas + (one && kind === 'panna' ? 1 : 0), player_two_pannas: match.player_two_pannas + (!one && kind === 'panna' ? 1 : 0),
      status: (match.player_one_points + (one ? bump : 0) >= 3 || match.player_two_points + (!one ? bump : 0) >= 3) ? 'final' : 'live', version: match.version + 1,
    }
    setMatches(current => current.map(item => item.id === match.id ? updated : item)); setStandings(playerStats(players, matches.map(item => item.id === match.id ? updated : item)))
    setSavingMatch(match.id); setNotice(`${kind === 'goal' ? '+1 goal' : '+2 panna'} · Pending Sync`); setError('')
    try {
      const result = await callAdmin({ mode: 'showdown_score', operation_id: crypto.randomUUID(), match_id: match.id, expected_version: match.version, player_id: playerId, action_type: kind })
      const saved = result.data as ShowdownMatch
      setMatches(current => current.map(item => item.id === match.id ? saved : item)); setStandings(playerStats(players, matches.map(item => item.id === match.id ? saved : item)))
      setNotice(saved.status === 'final' ? 'Match won · Synced' : 'Score saved · Synced')
    } catch (err) {
      setMatches(current => current.map(item => item.id === match.id ? before : item)); setStandings(playerStats(players, matches)); setError(err instanceof Error ? err.message : 'Score failed to sync.'); setNotice('Sync Failed'); void refreshAdmin().catch(() => undefined)
    } finally { setSavingMatch('') }
  }

  function beginCorrection(match: MatchRow) {
    setEditingMatch(match.id)
    setCorrection({ player_one_points: String(match.player_one_points), player_two_points: String(match.player_two_points), player_one_goals: String(match.player_one_goals), player_two_goals: String(match.player_two_goals), player_one_pannas: String(match.player_one_pannas), player_two_pannas: String(match.player_two_pannas), status: match.status })
  }

  async function correctMatch(event: React.FormEvent, match: MatchRow) {
    event.preventDefault()
    if (role !== 'super_admin' || savingMatch) return
    const values = Object.fromEntries(Object.entries(correction).map(([key, value]) => [key, key === 'status' ? value : Number(value)]))
    const optimistic = { ...match, ...values, version: match.version + 1 } as MatchRow
    setMatches(current => current.map(item => item.id === match.id ? optimistic : item)); setStandings(playerStats(players, matches.map(item => item.id === match.id ? optimistic : item))); setSavingMatch(match.id); setNotice('Saving correction…')
    try {
      const result = await callAdmin({ mode: 'showdown_match_correct', match_id: match.id, expected_version: match.version, ...values })
      const updated = result.data as ShowdownMatch
      setMatches(current => current.map(item => item.id === match.id ? updated : item)); setStandings(playerStats(players, matches.map(item => item.id === match.id ? updated : item))); setEditingMatch(''); setNotice('Match corrected · Synced')
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not correct match.'); setNotice('Sync Failed'); void refreshAdmin().catch(() => undefined) }
    finally { setSavingMatch('') }
  }

  const playerName = (id: string) => players.find(player => player.id === id)?.full_name ?? 'Registered player'
  const playerCollege = (id: string) => players.find(player => player.id === id)?.college_name

  return <section className="showdown-board" aria-label="Max Showdown panna competition">
    <div className="showdown-heading"><div><span className="kicker">PANNA COMPETITION</span><h2>Max Showdown</h2><p>Goals score 1 point · Pannas score 2 · first to 3 wins. Draws earn 1 tournament point each.</p></div><span className="showdown-count">{standings.length} PLAYERS</span></div>
    {role ? <>
      <nav className="showdown-admin-tabs" aria-label="Max Showdown admin sections"><button className={activeTab === 'registration' ? 'selected' : ''} onClick={() => setActiveTab('registration')}><UserPlus size={16} /> Registration</button><button className={activeTab === 'tracking' ? 'selected' : ''} onClick={() => setActiveTab('tracking')}><Flag size={16} /> Score tracking</button></nav>
      {activeTab === 'registration' ? <div className="showdown-sector">
        <form className="showdown-entry-form registration-form" onSubmit={event => void register(event)}>
          <label>Player full name<input required maxLength={100} value={fullName} onChange={event => setFullName(event.target.value)} placeholder="Enter full name" /></label>
          <label>College name · optional<input maxLength={120} value={collegeName} onChange={event => setCollegeName(event.target.value)} placeholder="Enter college" /></label>
          <label>Phone number<input required type="tel" autoComplete="tel" maxLength={30} value={phoneNumber} onChange={event => setPhoneNumber(event.target.value)} placeholder="Enter phone number" /></label>
          <button className="panel-action" disabled={saving || !fullName.trim() || !phoneNumber.trim()}>{saving ? 'Saving…' : 'Register player'}</button>
        </form>
        <div className="showdown-roster-heading"><div><h3>Registered players</h3><p>Registration IDs are assigned automatically. Phone numbers are admin-only.</p></div><label className="roster-search"><Search size={15} /><input value={playerSearch} onChange={event => setPlayerSearch(event.target.value)} placeholder="Search name, ID or college" /></label></div>
        <div className="showdown-roster">{visiblePlayers.map(player => <article className="showdown-roster-row" key={player.id}>{editingPlayer === player.id ? <form className="showdown-player-correction" onSubmit={event => void correctPlayer(event, player.id)}><label>Full name<input required maxLength={100} value={playerCorrection.full_name} onChange={event => setPlayerCorrection({ ...playerCorrection, full_name: event.target.value })} /></label><label>College · optional<input maxLength={120} value={playerCorrection.college_name} onChange={event => setPlayerCorrection({ ...playerCorrection, college_name: event.target.value })} /></label><label>Phone<input required type="tel" maxLength={30} value={playerCorrection.phone_number} onChange={event => setPlayerCorrection({ ...playerCorrection, phone_number: event.target.value })} /></label><div><button className="entry-save" disabled={saving}>Save</button><button type="button" className="entry-cancel" onClick={() => setEditingPlayer('')}>Cancel</button></div></form> : <><span className="showdown-rank"><UserPlus size={14} /></span><span className="roster-person"><b>{player.full_name}</b><small>{player.college_name || 'College not provided'} · {player.phone_number || 'Legacy entry · no phone on record'}</small></span><code>{player.registration_id}</code>{role === 'super_admin' && <button className="standings-refresh" onClick={() => beginPlayerCorrection(player)}>Edit</button>}</>}</article>)}{visiblePlayers.length === 0 && <div className="board-empty"><b>{players.length ? 'No players match your search.' : 'No players registered yet.'}</b></div>}</div>
      </div> : <div className="showdown-sector">
        <form className="showdown-fixture-form" onSubmit={event => void createFixture(event)}>
          <div><span className="kicker">NEW FIXTURE</span><h3>Draft a match</h3><p>Search registered players, then create the draft before the match starts.</p></div>
          <PlayerPicker label="Player 1" players={players} value={fixtureOne} onChange={player => setFixtureOne(player?.id ?? '')} excluded={fixtureTwo} />
          <PlayerPicker label="Player 2" players={players} value={fixtureTwo} onChange={player => setFixtureTwo(player?.id ?? '')} excluded={fixtureOne} />
          <button className="panel-action" disabled={saving || !fixtureOne || !fixtureTwo || fixtureOne === fixtureTwo}><Plus size={16} /> Create draft</button>
        </form>
        <div className="showdown-match-filters">{(['all','draft','live','final'] as const).map(item => <button key={item} className={filter === item ? 'selected' : ''} onClick={() => setFilter(item)}>{item === 'all' ? 'All' : item}</button>)}<button className="standings-refresh" onClick={() => { void refreshAdmin().catch(err => setError(err.message)); void refreshPublic() }}>Refresh</button></div>
        <div className="showdown-fixtures">{visibleMatches.map(match => <article className={`showdown-fixture ${match.status}`} key={match.id}>
          <div className="showdown-fixture-top"><span className={`showdown-match-status ${match.status}`}>{match.status}{match.pending && ' · Saving'}</span><small>{new Date(match.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</small></div>
          <div className="showdown-faceoff">
            <div className="showdown-contender"><b>{playerName(match.player_one_id)}</b>{playerCollege(match.player_one_id) && <small>{playerCollege(match.player_one_id)}</small>}<strong>{match.player_one_points}</strong><small>{match.player_one_goals} goals · {match.player_one_pannas} pannas</small></div>
            <span className="showdown-versus">VS</span>
            <div className="showdown-contender"><b>{playerName(match.player_two_id)}</b>{playerCollege(match.player_two_id) && <small>{playerCollege(match.player_two_id)}</small>}<strong>{match.player_two_points}</strong><small>{match.player_two_goals} goals · {match.player_two_pannas} pannas</small></div>
          </div>
          <div className="showdown-fixture-actions">
            {match.status === 'draft' && <button className="panel-action" disabled={savingMatch === match.id || match.pending} onClick={() => void setMatchStatus(match, 'live')}><Flag size={14} /> Start match</button>}
            {match.status === 'live' && <>
              {[{ id: match.player_one_id, name: playerName(match.player_one_id) }, { id: match.player_two_id, name: playerName(match.player_two_id) }].map(player => <div className="showdown-award-actions" key={player.id}><span>{player.name}</span><button disabled={savingMatch === match.id} onClick={() => void award(match, player.id, 'goal')}>+1 Goal</button><button className="panna-button" disabled={savingMatch === match.id} onClick={() => void award(match, player.id, 'panna')}>+2 Panna</button></div>)}
              <button className="entry-cancel" disabled={savingMatch === match.id} onClick={() => void setMatchStatus(match, 'final')}><Check size={14} /> End match</button>
            </>}
            {match.status === 'final' && <span className="final-result">{match.player_one_points === match.player_two_points ? 'Draw · +1 point each' : `${match.player_one_points > match.player_two_points ? playerName(match.player_one_id) : playerName(match.player_two_id)} wins · +2 tournament points`}</span>}
            {role === 'super_admin' && <button className="standings-refresh" onClick={() => beginCorrection(match)}>Edit match</button>}
          </div>
          {role === 'super_admin' && editingMatch === match.id && <form className="showdown-correction" onSubmit={event => void correctMatch(event, match)}>
            <b>Super Admin · Correct this fixture</b>
            <label>Player 1 match points<input required type="number" min="0" step="1" value={correction.player_one_points} onChange={event => setCorrection({ ...correction, player_one_points: event.target.value })} /></label>
            <label>Player 2 match points<input required type="number" min="0" step="1" value={correction.player_two_points} onChange={event => setCorrection({ ...correction, player_two_points: event.target.value })} /></label>
            <label>Player 1 goals<input required type="number" min="0" step="1" value={correction.player_one_goals} onChange={event => setCorrection({ ...correction, player_one_goals: event.target.value })} /></label>
            <label>Player 2 goals<input required type="number" min="0" step="1" value={correction.player_two_goals} onChange={event => setCorrection({ ...correction, player_two_goals: event.target.value })} /></label>
            <label>Player 1 pannas<input required type="number" min="0" step="1" value={correction.player_one_pannas} onChange={event => setCorrection({ ...correction, player_one_pannas: event.target.value })} /></label>
            <label>Player 2 pannas<input required type="number" min="0" step="1" value={correction.player_two_pannas} onChange={event => setCorrection({ ...correction, player_two_pannas: event.target.value })} /></label>
            <label>Match status<select value={correction.status} onChange={event => setCorrection({ ...correction, status: event.target.value as Correction['status'] })}><option value="draft">Draft</option><option value="live">Live</option><option value="final">Final</option></select></label>
            <div><button className="entry-save" disabled={savingMatch === match.id}>Save correction</button><button type="button" className="entry-cancel" onClick={() => setEditingMatch('')}>Cancel</button></div>
          </form>}
        </article>)}{visibleMatches.length === 0 && <div className="board-empty"><b>No {filter === 'all' ? '' : `${filter} `}fixtures yet.</b></div>}</div>
      </div>}
      {(notice || error) && <div className={`showdown-sync-note ${error ? 'failed' : ''}`} aria-live="polite">{error || notice}</div>}
    </> : <div className="showdown-volunteer-note"><Shield size={16} /><span>Admins use Registration and Score Tracking. This public view shows only the points table.</span><button onClick={onAdminLogin}>Admin sign in</button></div>}
    <section className="showdown-public-table" aria-label="Max Showdown points table">
      <div className="showdown-roster-heading"><div><span className="kicker">TOURNAMENT STANDINGS</span><h3>Points table</h3></div><span className="showdown-last-updated">{lastUpdated ? `Updated ${lastUpdated}` : ''}</span></div>
      {error && !role && <div className="error-banner"><div><b>Could not load Max Showdown standings</b><span>{error}</span></div><button onClick={() => void refreshPublic()}>Retry</button></div>}
      <div className="showdown-standings-scroll"><table className="showdown-standings"><thead><tr><th>Pos</th><th>Player</th><th>ID</th><th>College</th><th>MP</th><th>W</th><th>D</th><th>L</th><th>Goals</th><th>Pannas</th><th>Carry-over</th><th>Scored</th><th>Pts</th></tr></thead><tbody>
        {standings.map((entry, index) => <tr key={entry.player_id}><td>{index + 1}</td><th scope="row">{entry.full_name}</th><td>{entry.registration_id}</td><td>{entry.college_name || '—'}</td><td>{entry.played}</td><td>{entry.wins}</td><td>{entry.draws}</td><td>{entry.losses}</td><td>{entry.goals}</td><td>{entry.pannas}</td><td>{entry.legacy_points}</td><td className="showdown-standing-score">{entry.scored_points}</td><td className="showdown-standing-points">{entry.tournament_points}</td></tr>)}
        {standings.length === 0 && <tr><td colSpan={13} className="showdown-table-empty">No registered players yet. Scores will appear here after registration.</td></tr>}
      </tbody></table></div>
      <p className="showdown-table-note">Goal = 1 match point · Panna = 2 match points · Win = 2 tournament points · Draw = 1 each · Loss = 0. Carry-over preserves points entered before this update.</p>
      <button className="showdown-refresh-button" onClick={() => { void refreshPublic(); if (role) void refreshAdmin().catch(err => setError(err.message)) }}><Search size={14} /> Refresh standings</button>
    </section>
  </section>
}
