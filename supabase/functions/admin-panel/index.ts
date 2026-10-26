import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const encoder = new TextEncoder()
const json = (status: number, data: Record<string, unknown>) => new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

async function digest(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
}

async function sameSecret(candidate: string, expected: string | undefined) {
  if (!expected) return false
  const left = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(candidate)))
  const right = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(expected)))
  let difference = 0
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i]
  return difference === 0
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const adminPasscode = Deno.env.get('ADMIN_PASSCODE')
  const superAdminPasscode = Deno.env.get('SUPER_ADMIN_PASSCODE')
  if (!supabaseUrl || !serviceKey || !adminPasscode || !superAdminPasscode) return json(503, { error: 'Admin access is not configured on the server.' })

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return json(400, { error: 'Invalid request body.' }) }
  const candidate = typeof body.passcode === 'string' ? body.passcode : ''
  const superAdmin = await sameSecret(candidate, superAdminPasscode)
  const admin = superAdmin || await sameSecret(candidate, adminPasscode)
  if (!admin) {
    const client = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
    const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    const ipDigest = await digest(forwardedFor)
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString()
    const { count } = await client.from('admin_passcode_attempts').select('id', { count: 'exact', head: true }).eq('ip_digest', ipDigest).gte('attempted_at', since)
    if ((count ?? 0) >= 12) return json(429, { error: 'Too many attempts. Try again in 15 minutes.' })
    await client.from('admin_passcode_attempts').insert({ ip_digest: ipDigest })
    return json(401, { error: 'Incorrect passcode.' })
  }

  const role = superAdmin ? 'super_admin' : 'admin'
  if (body.mode === 'verify') return json(200, { role })
  const client = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  if (body.mode === 'score') {
    if (typeof body.operation_id !== 'string' || typeof body.match_id !== 'string' || typeof body.action_type !== 'string' || !body.payload || typeof body.payload !== 'object') return json(400, { error: 'Invalid score action.' })
    const { data, error } = await client.rpc('apply_match_action_server', {
      p_operation_id: body.operation_id,
      p_match_id: body.match_id,
      p_action_type: body.action_type,
      p_payload: body.payload,
      p_actor_role: role,
    })
    if (error) return json(400, { error: error.message })
    return json(200, { role, data })
  }

  if (body.mode === 'create_match') {
    if (!superAdmin) return json(403, { error: 'Super admin passcode required.' })
    const fixture = body.fixture as Record<string, unknown> | undefined
    if (!fixture || typeof fixture.home_team !== 'string' || typeof fixture.away_team !== 'string' || typeof fixture.venue !== 'string' || typeof fixture.kickoff_time !== 'string') return json(400, { error: 'Invalid fixture details.' })
    const { data, error } = await client.rpc('create_match_server', {
      p_home_team: fixture.home_team,
      p_away_team: fixture.away_team,
      p_event_day: fixture.event_day,
      p_kickoff_time: fixture.kickoff_time,
      p_venue: fixture.venue,
    })
    if (error) return json(400, { error: error.message })
    return json(200, { role, data })
  }

  return json(400, { error: 'Unsupported request.' })
})
