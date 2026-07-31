/* =============================== ROUTER =================================

   The Worker is deliberately thin. It owns nothing: every piece of mutable
   state lives in a Durable Object, so two requests that land in Frankfurt and
   Singapore still agree about who is in room 7KQ2MX.

   Responsibilities, in full:
     • room codes and the small JSON API around them
     • proxying the leaderboard so the anon key never ships to a phone
     • gatekeeping /api/match-result, which is the only write path into
       Supabase and therefore the only thing worth forging
     • upgrading /ws and handing the socket to the right MatchRoom            */

import { renderLanding } from '../../landing/src/worker.js';
import { MatchRoom } from './MatchRoom.js';
import { Matchmaker } from './Matchmaker.js';
import { MODES } from '../../shared/src/modes.js';
import { MODE_IDS } from '../../shared/src/constants.js';

export { MatchRoom, Matchmaker };

/* Crockford-ish: no O, no 0, no I, no 1. A code gets read aloud over a voice
   call more often than it gets copy-pasted, and "was that an I or a 1" is the
   single most common way a private room fails to fill. Exactly 32 symbols, so
   one random byte masked to 5 bits picks one with no modulo bias. */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LEN = 6;

export function makeCode(len = CODE_LEN) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] & 31];
  return out;
}

/** Codes arrive from humans, so accept lowercase and stray whitespace. */
function normaliseCode(raw) {
  if (!raw) return null;
  const c = String(raw).trim().toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (c.length !== CODE_LEN) return null;
  for (const ch of c) if (ALPHABET.indexOf(ch) < 0) return null;
  return c;
}

/* The Matchmaker retries against its own table if a candidate is taken, so
   handing it a short list makes room creation a single round trip instead of
   a retry loop across the network. */
function codeCandidates(n = 8) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(makeCode());
  return out;
}

/* ------------------------------------------------------------------ CORS */

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization,x-overrun-secret',
  'access-control-max-age': '86400'
};

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS, ...extra }
  });
}

/* ------------------------------------------------------------------ MAIN */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/ws') return handleSocket(request, env, url);

    // The marketing page. Served by the same Worker as the game so there is
    // one deploy, one domain and no CORS between them.
    if (path === '/landing' || path === '/about') return renderLanding(request);

    // The APK does not live on this Worker — CI publishes it to GitHub
    // Releases, which already has the bandwidth and the version history. A
    // stable redirect here means the landing page never has to know the tag.
    if (path === '/download/overrun.apk' || path === '/download') {
      return Response.redirect(
        'https://github.com/Mahdi-mortazavi/overrun/releases/latest/download/overrun.apk', 302
      );
    }

    // Invite links. /j/ABC123 is a deep link into a room; the client reads the
    // code off the path, so all this has to do is serve the game shell.
    if (path.startsWith('/j/')) {
      return env.ASSETS.fetch(new Request(new URL('/', url), request));
    }

    if (path.startsWith('/api/')) {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      try {
        return await api(request, env, url, path);
      } catch (err) {
        // An API fault must never take the game client down with it: the
        // client treats any non-2xx as "offline features unavailable".
        return json({ error: 'internal', detail: String((err && err.message) || err) }, 500);
      }
    }

    return env.ASSETS.fetch(request);
  }
};

async function api(request, env, url, path) {
  const mm = matchmaker(env);

  if (path === '/api/health' && request.method === 'GET') {
    return json({ ok: true, service: 'overrun', modes: MODE_IDS, now: Date.now() });
  }

  /* ---- create a private room --------------------------------------- */
  if (path === '/api/rooms' && request.method === 'POST') {
    const body = await readJson(request);
    const mode = pickMode(body.mode);
    const hostName = cleanName(body.hostName);
    const room = await mm.createRoom(mode, false, hostName, codeCandidates());
    if (!room) return json({ error: 'no_code' }, 503);
    return json({ code: room.code, mode: room.mode, maxPlayers: room.maxPlayers });
  }

  /* ---- room info ---------------------------------------------------- */
  if (path.startsWith('/api/rooms/') && request.method === 'GET') {
    const code = normaliseCode(path.slice('/api/rooms/'.length));
    if (!code) return json({ error: 'bad_code' }, 400);
    // Answered from the Matchmaker's table rather than by waking the room:
    // a lobby-browser refresh should never cost a MatchRoom instantiation.
    const room = await mm.findRoom(code);
    if (!room) return json({ exists: false, error: 'not_found' }, 404);
    return json({
      exists: true,
      code: room.code,
      mode: room.mode,
      playerCount: room.players,
      maxPlayers: room.maxPlayers,
      state: room.state,
      joinable: room.state === 'lobby' && room.players < room.maxPlayers
    });
  }

  /* ---- quickplay ---------------------------------------------------- */
  if (path === '/api/quickplay' && request.method === 'POST') {
    const body = await readJson(request);
    const mode = pickMode(body.mode);
    const room = await mm.quickplay(mode, codeCandidates(), cleanName(body.name));
    if (!room) return json({ error: 'no_code' }, 503);
    return json({ code: room.code, mode: room.mode, created: !!room.created });
  }

  /* ---- leaderboard (read-only proxy) -------------------------------- */
  if (path === '/api/leaderboard' && request.method === 'GET') {
    // The schema exposes two pre-aggregated views, not a per-mode table, so
    // the only knob here is the time window.
    const window = url.searchParams.get('window') === 'weekly' ? 'weekly' : 'alltime';
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '25', 10) || 25));
    const entries = await leaderboard(env, window, limit);
    // Cached at the edge: the leaderboard is the one thing every player loads
    // on the menu screen, and a minute of staleness is invisible.
    return json({ window, entries }, 200, { 'cache-control': 'public, max-age=60' });
  }

  /* ---- match result (internal only) --------------------------------- */
  if (path === '/api/match-result' && request.method === 'POST') {
    if (!env.INTERNAL_SECRET) return json({ error: 'not_configured' }, 503);
    if (!secretMatches(request.headers.get('x-overrun-secret'), env.INTERNAL_SECRET)) {
      // Deliberately uninformative. A forger learns nothing from a 403.
      return json({ error: 'forbidden' }, 403);
    }
    const body = await readJson(request);
    const ok = await forwardResult(env, body);
    return json({ ok });
  }

  return json({ error: 'not_found' }, 404);
}

/* ------------------------------------------------------------- WEBSOCKET */

async function handleSocket(request, env, url) {
  const upgrade = (request.headers.get('Upgrade') || '').toLowerCase();
  if (upgrade !== 'websocket') return new Response('expected websocket upgrade', { status: 426 });

  const code = normaliseCode(url.searchParams.get('code'));
  if (!code) return new Response('bad room code', { status: 400 });

  // The mode is resolved here, from the Matchmaker's table, and passed to the
  // room as a header. If the client were allowed to name the mode it could
  // join a co-op lobby as a squad player and desync everyone in it.
  const room = await matchmaker(env).findRoom(code);
  if (!room) return new Response('no such room', { status: 404 });

  const headers = new Headers(request.headers);
  headers.set('x-overrun-code', code);
  headers.set('x-overrun-mode', room.mode);

  const stub = env.MATCH_ROOM.get(env.MATCH_ROOM.idFromName(code));
  return stub.fetch(new Request(request.url, { method: request.method, headers }));
}

/* --------------------------------------------------------------- HELPERS */

function matchmaker(env) {
  // One global directory instance. Codes are globally unique or they are not
  // codes, and that uniqueness has to be decided in exactly one place.
  return env.MATCHMAKER.get(env.MATCHMAKER.idFromName('global'));
}

async function readJson(request) {
  try {
    const v = await request.json();
    return (v && typeof v === 'object') ? v : {};
  } catch { return {}; }
}

function pickMode(raw) {
  const m = String(raw || '').toLowerCase();
  return MODES[m] ? m : 'coop';
}

/** Control characters out, 18 visible characters max. The name ends up in a
 *  kill feed rendered at 14px; anything longer is a griefing tool. */
function cleanName(raw) {
  let out = '';
  for (const ch of String(raw || '')) {
    const c = ch.codePointAt(0);
    if (c >= 0x20 && c !== 0x7f) out += ch;
    if (out.length >= 18) break;
  }
  return out.trim() || 'RUNNER';
}

/** Length-independent compare. Overkill for a header nobody can measure across
 *  the internet, but it costs four lines. */
function secretMatches(given, expected) {
  if (typeof given !== 'string' || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

async function leaderboard(env, window, limit) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return [];
  // game.leaderboard_alltime / game.leaderboard_weekly: security-invoker views
  // over a SECURITY DEFINER aggregate, so `anon` can read standings without
  // being able to read a single row of profiles or match_players.
  const q = new URL(env.SUPABASE_URL + '/rest/v1/leaderboard_' + window);
  q.searchParams.set('select', 'rank,handle,total_kills,total_score,matches,wins,best_wave,kd');
  q.searchParams.set('order', 'rank.asc');
  q.searchParams.set('limit', String(limit));
  try {
    const res = await fetch(q.toString(), {
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        authorization: 'Bearer ' + env.SUPABASE_ANON_KEY,
        // Tables live in the `game` schema, not `public`.
        'accept-profile': env.SUPABASE_SCHEMA || 'game'
      }
    });
    if (!res.ok) return [];
    const rows = await res.json();
    return Array.isArray(rows) ? rows : [];
  } catch {
    // A leaderboard nobody can reach is a cosmetic problem. It must never be
    // the reason a player cannot get into a match.
    return [];
  }
}

/* The `submit-match` Edge Function authenticates on a `secret` field in the
   body, not a header, and it is the only write path into game.matches — the
   tables have no INSERT policy for anyone else. MATCH_SECRET is injected here
   so it lives in exactly one place and never crosses the DO hop. */
async function forwardResult(env, body) {
  if (!env.SUPABASE_URL || !env.MATCH_SECRET) return false;
  const key = env.SUPABASE_SERVICE_KEY || env.SUPABASE_ANON_KEY;
  try {
    const res = await fetch(env.SUPABASE_URL + '/functions/v1/submit-match', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(key ? { apikey: key, authorization: 'Bearer ' + key } : {})
      },
      body: JSON.stringify({ ...body, secret: env.MATCH_SECRET })
    });
    return res.ok;
  } catch {
    return false;
  }
}
