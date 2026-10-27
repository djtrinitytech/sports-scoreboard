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

  if (body.mode === 'showdown_add') {
    const participantName = typeof body.participant_name === 'string' ? body.participant_name.trim() : ''
    const score = Number(body.score)
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.operation_id ?? '') || participantName.length < 1 || participantName.length > 80 || !Number.isInteger(score) || score < 0) {
      return send(res, 400, { error: 'Enter a name up to 80 characters and a whole-number score of zero or more.' })
    }
    const { data: inserted, error: insertError } = await client
      .from('max_showdown_entries')
      .upsert({ operation_id: body.operation_id, participant_name: participantName, score }, { onConflict: 'operation_id', ignoreDuplicates: true })
      .select('*')
      .maybeSingle()
    if (insertError) return send(res, 400, { error: insertError.message })
    if (inserted) return send(res, 200, { role, data: inserted })
    const { data, error } = await client.from('max_showdown_entries').select('*').eq('operation_id', body.operation_id).single()
    if (error) return send(res, 400, { error: error.message })
    return send(res, 200, { role, data })
  }

  if (body.mode === 'showdown_edit') {
    if (!superAdmin) return send(res, 403, { error: 'Super admin passcode required.' })
    const participantName = typeof body.participant_name === 'string' ? body.participant_name.trim() : ''
    const score = Number(body.score)
    if (typeof body.entry_id !== 'string' || participantName.length < 1 || participantName.length > 80 || !Number.isInteger(score) || score < 0) {
      return send(res, 400, { error: 'Enter a name up to 80 characters and a whole-number score of zero or more.' })
    }
    const { data, error } = await client.from('max_showdown_entries').update({ participant_name: participantName, score, updated_at: new Date().toISOString() }).eq('id', body.entry_id).select('*').single()
    if (error) return send(res, 400, { error: error.message })
    return send(res, 200, { role, data })
  }

  if (body.mode === 'showdown_delete') {
    if (!superAdmin) return send(res, 403, { error: 'Super admin passcode required.' })
    if (typeof body.entry_id !== 'string') return send(res, 400, { error: 'Invalid Max Showdown entry.' })
    const { error } = await client.from('max_showdown_entries').delete().eq('id', body.entry_id)
    if (error) return send(res, 400, { error: error.message })
    return send(res, 200, { role, data: { id: body.entry_id } })
  }

  return send(res, 400, { error: 'Unsupported request.' })
}
