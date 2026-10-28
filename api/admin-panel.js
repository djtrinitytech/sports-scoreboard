import { createHash, timingSafeEqual } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

function send(res, status, data) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(data))
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  if (typeof req.body === 'string') return JSON.parse(req.body)
  let raw = ''
  for await (const chunk of req) raw += chunk
  return raw ? JSON.parse(raw) : {}
}

function matchesSecret(candidate, expected) {
  if (!expected) return false
  const candidateDigest = createHash('sha256').update(candidate).digest()
  const expectedDigest = createHash('sha256').update(expected).digest()
  return timingSafeEqual(candidateDigest, expectedDigest)
}

function getAdminClient() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !secret) return null
  return createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

export default async function adminPanel(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' })

  const adminPasscode = process.env.ADMIN_PASSCODE
  const superAdminPasscode = process.env.SUPER_ADMIN_PASSCODE
  const client = getAdminClient()
  if (!adminPasscode || !superAdminPasscode || !client) {
    return send(res, 503, { error: 'Admin access is not configured on the server.' })
  }

  let body
  try {
    const parsedBody = await readBody(req)
    body = parsedBody && typeof parsedBody === 'object' && !Array.isArray(parsedBody) ? parsedBody : {}
  } catch {
    return send(res, 400, { error: 'Invalid request body.' })
  }

  const candidate = typeof body.passcode === 'string' ? body.passcode : ''
  const superAdmin = matchesSecret(candidate, superAdminPasscode)
  const admin = superAdmin || matchesSecret(candidate, adminPasscode)
  if (!admin) {
    const forwardedFor = req.headers['x-forwarded-for']
    const clientIp = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor)?.split(',')[0]?.trim() || 'unknown'
    const ipDigest = createHash('sha256').update(clientIp).digest('hex')
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString()
    const { count, error: countError } = await client
      .from('admin_passcode_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('ip_digest', ipDigest)
      .gte('attempted_at', since)
    if (countError) return send(res, 500, { error: 'Could not check admin access attempts.' })
    if ((count ?? 0) >= 12) return send(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' })
    const { error: insertError } = await client.from('admin_passcode_attempts').insert({ ip_digest: ipDigest })
    if (insertError) return send(res, 500, { error: 'Could not record admin access attempt.' })
    return send(res, 401, { error: 'Incorrect passcode.' })
  }

  const role = superAdmin ? 'super_admin' : 'admin'
  if (body.mode === 'verify') return send(res, 200, { role })

  if (body.mode === 'score') {
    if (typeof body.operation_id !== 'string' || typeof body.match_id !== 'string' || typeof body.action_type !== 'string' || !body.payload || typeof body.payload !== 'object') {
      return send(res, 400, { error: 'Invalid score action.' })
    }
    const { data, error } = await client.rpc('apply_match_action_server', {
      p_operation_id: body.operation_id,
      p_match_id: body.match_id,
      p_action_type: body.action_type,
      p_payload: body.payload,
      p_actor_role: role,
    })
    if (error) return send(res, 400, { error: error.message })
    return send(res, 200, { role, data })
  }

  if (body.mode === 'match_cards') {
    const { match_id: matchId, expected_version: expectedVersion, home_yellow_cards: homeYellowCards, away_yellow_cards: awayYellowCards, home_red_cards: homeRedCards, away_red_cards: awayRedCards, home_fair_play_score: homeFairPlay, away_fair_play_score: awayFairPlay } = body
    if (typeof matchId !== 'string' || !Number.isSafeInteger(expectedVersion) || !Number.isSafeInteger(homeYellowCards) || homeYellowCards < 0 || !Number.isSafeInteger(awayYellowCards) || awayYellowCards < 0 || !Number.isSafeInteger(homeRedCards) || homeRedCards < 0 || !Number.isSafeInteger(awayRedCards) || awayRedCards < 0 || !Number.isSafeInteger(homeFairPlay) || !Number.isSafeInteger(awayFairPlay)) return send(res, 400, { error: 'Enter non-negative whole-number card totals and fair-play points.' })
    const { data, error } = await client.rpc('update_match_discipline_server', { p_match_id: matchId, p_expected_version: expectedVersion, p_home_yellow_cards: homeYellowCards, p_away_yellow_cards: awayYellowCards, p_home_red_cards: homeRedCards, p_away_red_cards: awayRedCards, p_home_fair_play_score: homeFairPlay, p_away_fair_play_score: awayFairPlay, p_actor_role: role })
    if (error) return send(res, 400, { error: error.message })
    return send(res, 200, { role, data })
  }

  if (body.mode === 'match_penalties') {
    const { match_id: matchId, expected_version: expectedVersion, home_penalty_score: homePenaltyScore, away_penalty_score: awayPenaltyScore } = body
    if (typeof matchId !== 'string' || !Number.isSafeInteger(expectedVersion) || !Number.isSafeInteger(homePenaltyScore) || homePenaltyScore < 0 || !Number.isSafeInteger(awayPenaltyScore) || awayPenaltyScore < 0 || homePenaltyScore > 1000 || awayPenaltyScore > 1000) return send(res, 400, { error: 'Enter non-negative whole-number penalty scores.' })
    const { data, error } = await client.rpc('set_knockout_penalties_server', { p_match_id: matchId, p_expected_version: expectedVersion, p_home_penalty_score: homePenaltyScore, p_away_penalty_score: awayPenaltyScore, p_actor_role: role })
    if (error) return send(res, 400, { error: error.message })
    return send(res, 200, { role, data })
  }

  if (body.mode === 'match_edit') {
    if (!superAdmin) return send(res, 403, { error: 'Super admin passcode required.' })
    const { match_id: matchId, expected_version: expectedVersion, home_team: homeTeam, away_team: awayTeam, home_score: homeScore, away_score: awayScore, home_yellow_cards: homeYellowCards, away_yellow_cards: awayYellowCards, home_red_cards: homeRedCards, away_red_cards: awayRedCards, home_fair_play_score: homeFairPlay, away_fair_play_score: awayFairPlay, status, event_day: eventDay, kickoff_time: kickoffTime, venue, stage } = body
    if (typeof matchId !== 'string' || !Number.isSafeInteger(expectedVersion) || typeof homeTeam !== 'string' || typeof awayTeam !== 'string' || homeTeam === awayTeam || !Number.isSafeInteger(homeScore) || homeScore < 0 || !Number.isSafeInteger(awayScore) || awayScore < 0 || !Number.isSafeInteger(homeYellowCards) || homeYellowCards < 0 || !Number.isSafeInteger(awayYellowCards) || awayYellowCards < 0 || !Number.isSafeInteger(homeRedCards) || homeRedCards < 0 || !Number.isSafeInteger(awayRedCards) || awayRedCards < 0 || !Number.isSafeInteger(homeFairPlay) || !Number.isSafeInteger(awayFairPlay) || !['upcoming', 'live', 'final'].includes(status) || !Number.isInteger(eventDay) || eventDay < 1 || eventDay > 32767 || typeof kickoffTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(kickoffTime) || typeof venue !== 'string' || !venue.trim() || venue.trim().length > 120 || typeof stage !== 'string' || !stage.trim() || stage.trim().length > 40) {
      return send(res, 400, { error: 'Check the match teams, score, cards, fair-play points, status, day, time, venue, and stage.' })
    }
    const { data, error } = await client.rpc('update_match_super_admin', {
      p_match_id: matchId,
      p_expected_version: expectedVersion,
      p_home_team: homeTeam,
      p_away_team: awayTeam,
      p_home_score: homeScore,
      p_away_score: awayScore,
      p_home_yellow_cards: homeYellowCards,
      p_away_yellow_cards: awayYellowCards,
      p_home_red_cards: homeRedCards,
      p_away_red_cards: awayRedCards,
      p_home_fair_play_score: homeFairPlay,
      p_away_fair_play_score: awayFairPlay,
      p_status: status,
      p_event_day: eventDay,
      p_kickoff_time: kickoffTime,
      p_venue: venue.trim(),
      p_stage: stage.trim(),
    })
    if (error) return send(res, 400, { error: error.message })
    return send(res, 200, { role, data })
  }

  if (body.mode === 'create_match') {
    if (!superAdmin) return send(res, 403, { error: 'Super admin passcode required.' })
    const fixture = body.fixture
    if (!fixture || typeof fixture.home_team !== 'string' || typeof fixture.away_team !== 'string' || typeof fixture.venue !== 'string' || typeof fixture.kickoff_time !== 'string') {
      return send(res, 400, { error: 'Invalid fixture details.' })
    }
    const { data, error } = await client.rpc('create_match_server', {
      p_home_team: fixture.home_team,
      p_away_team: fixture.away_team,
      p_event_day: fixture.event_day,
      p_kickoff_time: fixture.kickoff_time,
      p_venue: fixture.venue,
    })
    if (error) return send(res, 400, { error: error.message })
    return send(res, 200, { role, data })
  }

  if (body.mode === 'showdown_admin_data') {
    const [players, matches] = await Promise.all([
      client.from('max_showdown_players').select('*').order('created_at', { ascending: false }),
      client.from('max_showdown_matches').select('*').order('created_at', { ascending: false }),
    ])
    const problem = players.error ?? matches.error
    if (problem) return send(res, 400, { error: problem.message })
    return send(res, 200, { role, players: players.data ?? [], matches: matches.data ?? [] })
  }

  if (body.mode === 'showdown_register') {
    const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : ''
    const college = typeof body.college_name === 'string' ? body.college_name.trim() : ''
    const phone = typeof body.phone_number === 'string' ? body.phone_number.trim() : ''
    if (fullName.length < 1 || fullName.length > 100 || college.length > 120 || phone.length < 5 || phone.length > 30) return send(res, 400, { error: 'Enter a full name, a valid phone number, and an optional college (up to 120 characters).' })
    const { data, error } = await client.rpc('register_max_showdown_player_server', { p_full_name: fullName, p_college_name: college || null, p_phone_number: phone })
    if (error) return send(res, 400, { error: error.message })
    return send(res, 200, { role, data })
  }

  if (body.mode === 'showdown_player_edit') {
    if (!superAdmin) return send(res, 403, { error: 'Super admin passcode required.' })
    const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : ''
    const college = typeof body.college_name === 'string' ? body.college_name.trim() : ''
    const phone = typeof body.phone_number === 'string' ? body.phone_number.trim() : ''
    if (typeof body.player_id !== 'string' || fullName.length < 1 || fullName.length > 100 || college.length > 120 || phone.length < 5 || phone.length > 30 || !Number.isSafeInteger(body.legacy_points) || body.legacy_points < 0) return send(res, 400, { error: 'Enter a name, valid phone number, optional college, and non-negative carry-over points.' })
    const { data, error } = await client.rpc('correct_max_showdown_player_server', { p_player_id: body.player_id, p_full_name: fullName, p_college_name: college || null, p_phone_number: phone, p_legacy_points: body.legacy_points })
    if (error) return send(res, 400, { error: error.message })
    return send(res, 200, { role, data })
  }

  if (body.mode === 'showdown_player_delete') {
    if (!superAdmin) return send(res, 403, { error: 'Super admin passcode required.' })
    if (typeof body.player_id !== 'string') return send(res, 400, { error: 'Choose a registered player.' })
    const { data, error } = await client.rpc('delete_max_showdown_player_server', { p_player_id: body.player_id })
    if (error) return send(res, 400, { error: error.message })
    return send(res, 200, { role, data })
  }

  if (body.mode === 'showdown_fixture') {
    if (typeof body.player_one_id !== 'string' || typeof body.player_two_id !== 'string') return send(res, 400, { error: 'Choose two registered players.' })
    const { data, error } = await client.rpc('create_max_showdown_match_server', { p_player_one_id: body.player_one_id, p_player_two_id: body.player_two_id, p_actor_role: role })
    if (error) return send(res, 400, { error: error.message })
    return send(res, 200, { role, data })
  }

  if (body.mode === 'showdown_status') {
    if (typeof body.match_id !== 'string' || !Number.isSafeInteger(body.expected_version) || !['live', 'final'].includes(body.status)) return send(res, 400, { error: 'Invalid Max Showdown match status.' })
    const { data, error } = await client.rpc('set_max_showdown_match_status_server', { p_match_id: body.match_id, p_expected_version: body.expected_version, p_status: body.status })
    if (error) return send(res, 400, { error: error.message })
    return send(res, 200, { role, data })
  }

  if (body.mode === 'showdown_score') {
    if (typeof body.operation_id !== 'string' || typeof body.match_id !== 'string' || typeof body.player_id !== 'string' || !Number.isSafeInteger(body.expected_version) || !['goal', 'panna'].includes(body.action_type)) return send(res, 400, { error: 'Invalid Max Showdown score action.' })
    const { data, error } = await client.rpc('apply_max_showdown_score_server', { p_operation_id: body.operation_id, p_match_id: body.match_id, p_expected_version: body.expected_version, p_player_id: body.player_id, p_action_type: body.action_type, p_actor_role: role })
    if (error) return send(res, 400, { error: error.message })
    return send(res, 200, { role, data })
  }

  if (body.mode === 'showdown_match_correct') {
    if (!superAdmin) return send(res, 403, { error: 'Super admin passcode required.' })
    const fields = ['player_one_points', 'player_two_points', 'player_one_goals', 'player_two_goals', 'player_one_pannas', 'player_two_pannas']
    if (typeof body.match_id !== 'string' || !Number.isSafeInteger(body.expected_version) || fields.some(field => !Number.isSafeInteger(body[field]) || body[field] < 0) || !['draft', 'live', 'final'].includes(body.status)) return send(res, 400, { error: 'Enter valid non-negative scores and match stats.' })
    const { data, error } = await client.rpc('correct_max_showdown_match_server', { p_match_id: body.match_id, p_expected_version: body.expected_version, p_one_points: body.player_one_points, p_two_points: body.player_two_points, p_one_goals: body.player_one_goals, p_two_goals: body.player_two_goals, p_one_pannas: body.player_one_pannas, p_two_pannas: body.player_two_pannas, p_status: body.status })
    if (error) return send(res, 400, { error: error.message })
    return send(res, 200, { role, data })
  }

  if (body.mode === 'showdown_match_delete') {
    if (!superAdmin) return send(res, 403, { error: 'Super admin passcode required.' })
    if (typeof body.match_id !== 'string' || !Number.isSafeInteger(body.expected_version)) return send(res, 400, { error: 'Refresh this fixture before deleting it.' })
    const { data, error } = await client.rpc('delete_max_showdown_match_server', { p_match_id: body.match_id, p_expected_version: body.expected_version })
    if (error) return send(res, 400, { error: error.message })
    return send(res, 200, { role, data })
  }

  return send(res, 400, { error: 'Unsupported request.' })
}
