const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const DEFAULT_AI_GATEWAY_OPENAI_CHAT_URL = 'https://gateway.ai.cloudflare.com/v1/bd0c3fba48bff8f5bec8f88cd625c719/vnboss-gateway/compat/chat/completions';
const DEFAULT_AI_GATEWAY_ACCOUNT_ID = 'bd0c3fba48bff8f5bec8f88cd625c719';
const DEFAULT_AI_GATEWAY_ID = 'vnboss-gateway';
const OPENAI_TIMEOUT_MS = 45000;
// Bump this on every worker deploy so /api/version confirms what is actually live.
const WORKER_VERSION = '2026-07-06-news-gpt4o';

// Estimated OpenAI prices (USD per 1M tokens). Edit if OpenAI pricing changes.
const OPENAI_PRICING = {
  'gpt-4o-mini': { in: 0.15, out: 0.60 },
  'gpt-4o': { in: 2.50, out: 10.00 },
  'gpt-4o-2024-08-06': { in: 2.50, out: 10.00 },
  'gpt-5-mini': { in: 0.25, out: 2.00 }
};
const OPENAI_PRICING_DEFAULT = { in: 0.15, out: 0.60 };

// Admin access is gated on a verified Firebase Google login, not a shared secret.
const FIREBASE_PROJECT_ID = 'vn-boss';
const ADMIN_EMAILS = ['sirisiri1148@gmail.com'];
const FIREBASE_JWK_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let cachedFirebaseJwks = null;
let cachedFirebaseJwksExpiry = 0;
let cachedGoogleAccessToken = null;
let cachedGoogleAccessTokenExpiry = 0;

const DAILY_LIMITS = {
  guest: 0,
  free: 10
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-VN-Boss-Member-State, X-VN-Boss-User-Id, X-VN-Boss-Email, X-VN-Boss-Display-Name, X-VN-Boss-Admin-Secret',
  'Access-Control-Max-Age': '86400'
};

const MAX_ERROR_LOG_ENTRIES = 20;

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      console.error('[VN Boss Worker] Unhandled error:', error);
      return jsonResponse({
        message: '서버 연결을 확인해주세요.',
        userFriendly: true,
        code: 'WORKER_UNHANDLED_ERROR'
      }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    // Daily auto-generation is intentionally DISABLED to control API cost.
    // News is now generated on demand from the admin (candidate selection).
    // Kept as a no-op so any leftover cron trigger costs nothing.
    console.log('[VN Boss Worker] scheduled tick — auto news generation disabled by design.');
  }
};

async function handleRequest(request, env) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(request.url);

  if (url.pathname.startsWith('/api/admin/')) {
    return handleAdminRequest(request, env, url);
  }

  if (url.pathname === '/api/member-info' && request.method === 'GET') {
    return handleMemberInfo(request, env);
  }

  if (url.pathname === '/api/member-register' && request.method === 'POST') {
    return handleMemberRegister(request, env);
  }

  if (url.pathname === '/api/version' && request.method === 'GET') {
    return jsonResponse({
      version: WORKER_VERSION,
      newsSummaryModel: NEWS_SUMMARY_MODEL,
      newsRankModel: NEWS_RANK_MODEL,
      articleCharLimit: 9000,
      hasOpenAiKey: Boolean(env.OPENAI_API_KEY),
      hasServiceAccount: Boolean(env.FIREBASE_SERVICE_ACCOUNT)
    }, 200);
  }

  if (url.pathname === '/api/news' && request.method === 'GET') {
    const news = await getNewsList(env, 'news:published');
    return jsonResponse({ news: news.slice(0, 20) }, 200);
  }

  if (url.pathname === '/api/news/comments' && request.method === 'GET') {
    return handleGetComments(env, url);
  }

  if (url.pathname === '/api/news/comments' && request.method === 'POST') {
    return handleAddComment(request, env);
  }

  if (url.pathname === '/api/news/comments/delete' && request.method === 'POST') {
    return handleDeleteComment(request, env);
  }

  if (url.pathname !== '/api/generate') {
    return jsonResponse({ message: 'Not found' }, 404);
  }

  if (request.method !== 'POST') {
    return jsonResponse({ message: 'Method not allowed' }, 405);
  }

  if (!env.OPENAI_API_KEY) {
    console.error('[VN Boss Worker] OPENAI_API_KEY is missing.');
    return jsonResponse({ message: 'OpenAI API 키 설정을 확인해주세요.', userFriendly: true, code: 'OPENAI_KEY_MISSING' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch (error) {
    console.error('[VN Boss Worker] Invalid request body:', error);
    return jsonResponse({ message: '요청 내용을 확인해주세요.', userFriendly: true }, 400);
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) {
    return jsonResponse({ message: '작성할 내용이 필요합니다.', userFriendly: true }, 400);
  }

  const memberState = getMemberState(request);
  await recordMember(env, memberState);
  const quota = await checkDailyQuota(env, memberState);
  console.log('[VN Boss Worker] quota check:', JSON.stringify({ memberType: memberState.type, userId: memberState.userId, allowed: quota.allowed, used: quota.used, limit: quota.limit }));
  if (!quota.allowed) {
    console.warn('[VN Boss Worker] request blocked before AI Gateway:', JSON.stringify({ memberType: memberState.type, quota }));
    return jsonResponse({
      message: memberState.type === 'guest'
        ? '서비스 보호를 위해 비회원 메시지 작성은 제공하지 않습니다. 무료 회원으로 시작하면 하루 10회까지 사용할 수 있습니다.'
        : '오늘의 무료 회원 메시지 작성 사용량을 모두 사용했습니다. 내일 다시 이용해주세요.',
      userFriendly: true,
      quota
    }, 429);
  }

  try {
    const model = getOpenAIModel(env);
    const gatewayUrl = getOpenAIChatEndpoint(env);
    console.log('[VN Boss Worker] calling AI Gateway:', gatewayUrl);
    const result = await generateWithOpenAIChat(prompt, model, env.OPENAI_API_KEY, gatewayUrl, env);
    await recordDailyQuota(env, quota);

    return jsonResponse({
      korean: result.korean,
      vietnamese: result.vietnamese,
      quota: { ...quota, used: quota.used + 1 }
    }, 200);
  } catch (error) {
    console.error('[VN Boss Worker] OpenAI request failed:', error);
    const status = error.publicStatus || 503;
    const message = error.publicMessage || '현재 이용량이 많습니다. 잠시 후 다시 시도해주세요.';
    await recordErrorLog(env, {
      code: error.publicCode || 'AI_REQUEST_FAILED',
      message: error.publicMessage || error.message || 'unknown error',
      status,
      memberType: memberState.type,
      userId: memberState.userId
    });
    return jsonResponse({ message, userFriendly: true, code: error.publicCode || 'AI_REQUEST_FAILED' }, status);
  }
}

function getAdminEmails(env) {
  const fromEnv = (env.ADMIN_EMAILS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return fromEnv.length ? fromEnv : ADMIN_EMAILS.map((value) => value.toLowerCase());
}

function base64UrlToBytes(value) {
  let normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4;
  if (pad) normalized += '='.repeat(4 - pad);
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64UrlToString(value) {
  return new TextDecoder().decode(base64UrlToBytes(value));
}

async function getFirebaseJwks() {
  const now = Date.now();
  if (cachedFirebaseJwks && now < cachedFirebaseJwksExpiry) return cachedFirebaseJwks;
  const response = await fetch(FIREBASE_JWK_URL);
  if (!response.ok) throw new Error('Failed to fetch Firebase public keys');
  const data = await response.json();
  const map = {};
  for (const key of data.keys || []) map[key.kid] = key;
  cachedFirebaseJwks = map;
  cachedFirebaseJwksExpiry = now + 60 * 60 * 1000;
  return map;
}

async function verifyFirebaseIdToken(token) {
  const parts = (token || '').split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;

  let header;
  let payload;
  try {
    header = JSON.parse(base64UrlToString(headerB64));
    payload = JSON.parse(base64UrlToString(payloadB64));
  } catch (error) {
    return null;
  }

  if (header.alg !== 'RS256' || !header.kid) return null;

  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== FIREBASE_PROJECT_ID) return null;
  if (payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) return null;
  if (!payload.exp || payload.exp < now) return null;
  if (payload.iat && payload.iat > now + 300) return null;
  if (!payload.sub) return null;

  let jwks;
  try {
    jwks = await getFirebaseJwks();
  } catch (error) {
    console.error('[VN Boss Worker] JWK fetch failed:', error);
    return null;
  }
  const jwk = jwks[header.kid];
  if (!jwk) return null;

  let key;
  try {
    key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
  } catch (error) {
    console.error('[VN Boss Worker] importKey failed:', error);
    return null;
  }

  const signature = base64UrlToBytes(signatureB64);
  const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  let valid = false;
  try {
    valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signedData);
  } catch (error) {
    return null;
  }
  return valid ? payload : null;
}

async function isAdminRequest(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    console.log('[VN Boss Worker] admin auth: no bearer token');
    return false;
  }

  const payload = await verifyFirebaseIdToken(match[1].trim());
  if (!payload) {
    console.log('[VN Boss Worker] admin auth: token verification failed');
    return false;
  }

  const email = (payload.email || '').toLowerCase();
  const allowed = getAdminEmails(env).includes(email) && payload.email_verified !== false;
  console.log('[VN Boss Worker] admin auth check:', JSON.stringify({ email, allowed }));
  return allowed;
}

/* ---- Firebase Admin: list all Authentication users via a service account ---- */

function getServiceAccount(env) {
  const raw = env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.client_email && parsed.private_key) return parsed;
    return null;
  } catch (error) {
    console.error('[VN Boss Worker] FIREBASE_SERVICE_ACCOUNT parse failed:', error);
    return null;
  }
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function stringToBase64Url(value) {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function pemToPkcs8Bytes(pem) {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function getGoogleAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedGoogleAccessToken && now < cachedGoogleAccessTokenExpiry - 60) {
    return cachedGoogleAccessToken;
  }

  const sa = getServiceAccount(env);
  if (!sa) return null;

  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/identitytoolkit',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };
  const signingInput = `${stringToBase64Url(JSON.stringify(header))}.${stringToBase64Url(JSON.stringify(claims))}`;

  let key;
  try {
    key = await crypto.subtle.importKey(
      'pkcs8',
      pemToPkcs8Bytes(sa.private_key),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );
  } catch (error) {
    console.error('[VN Boss Worker] service account key import failed:', error);
    return null;
  }

  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${bytesToBase64Url(new Uint8Array(signature))}`;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}`
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    console.error('[VN Boss Worker] token exchange failed:', response.status, data);
    return null;
  }

  cachedGoogleAccessToken = data.access_token;
  cachedGoogleAccessTokenExpiry = now + (Number(data.expires_in) || 3600);
  return cachedGoogleAccessToken;
}

async function listFirebaseUsers(env, accessToken) {
  const users = [];
  let pageToken = '';
  do {
    const url = `https://identitytoolkit.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/accounts:batchGet?maxResults=1000${pageToken ? `&nextPageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`listFirebaseUsers ${response.status}: ${text.slice(0, 200)}`);
    }
    const data = await response.json();
    if (Array.isArray(data.users)) users.push(...data.users);
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return users;
}

async function handleAdminRequest(request, env, url) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (!(await isAdminRequest(request, env))) {
    return jsonResponse({ message: '관리자 인증이 필요합니다.', userFriendly: true, code: 'ADMIN_AUTH_REQUIRED' }, 401);
  }

  if (!env.USAGE_KV) {
    return jsonResponse({ message: 'KV 저장소가 연결되지 않았습니다.', userFriendly: true, code: 'KV_NOT_BOUND' }, 500);
  }

  if (url.pathname === '/api/admin/members' && request.method === 'GET') {
    const result = await listMembers(env);
    return jsonResponse({ members: result.members, integrated: result.integrated }, 200);
  }

  if (url.pathname === '/api/admin/errors' && request.method === 'GET') {
    const errors = await getErrorLog(env);
    return jsonResponse({ errors }, 200);
  }

  if (url.pathname === '/api/admin/usage' && request.method === 'GET') {
    return jsonResponse(await handleUsage(env), 200);
  }

  if (url.pathname === '/api/admin/usage-balance' && request.method === 'POST') {
    let body;
    try {
      body = await request.json();
    } catch (error) {
      return jsonResponse({ message: '요청 내용을 확인해주세요.', userFriendly: true }, 400);
    }
    return jsonResponse(await handleSetBalance(env, body.amount), 200);
  }

  if (url.pathname === '/api/admin/reset-quota' && request.method === 'POST') {
    let body;
    try {
      body = await request.json();
    } catch (error) {
      return jsonResponse({ message: '요청 내용을 확인해주세요.', userFriendly: true }, 400);
    }
    const userId = typeof body.userId === 'string' ? body.userId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) : '';
    const memberType = body.memberType === 'guest' ? 'guest' : 'free';
    if (!userId) {
      return jsonResponse({ message: 'userId가 필요합니다.', userFriendly: true }, 400);
    }
    const key = `usage:${getQuotaDate()}:${memberType}:${userId}`;
    await env.USAGE_KV.delete(key);
    return jsonResponse({ message: '사용량이 초기화되었습니다.' }, 200);
  }

  if (url.pathname === '/api/admin/news-drafts' && request.method === 'GET') {
    const drafts = await getNewsList(env, 'news:drafts');
    const published = await getNewsList(env, 'news:published');
    return jsonResponse({ drafts, published }, 200);
  }

  if (url.pathname === '/api/admin/news-generate' && request.method === 'POST') {
    const result = await generateNewsDrafts(env);
    return jsonResponse(result, 200);
  }

  if (url.pathname === '/api/admin/news-candidates' && request.method === 'POST') {
    const result = await handleNewsCandidates(env);
    return jsonResponse(result, 200);
  }

  if (url.pathname === '/api/admin/news-regenerate' && request.method === 'POST') {
    let body;
    try {
      body = await request.json();
    } catch (error) {
      return jsonResponse({ message: '요청 내용을 확인해주세요.', userFriendly: true }, 400);
    }
    const id = typeof body.id === 'string' ? body.id : '';
    if (!id) return jsonResponse({ message: 'id가 필요합니다.', userFriendly: true }, 400);
    const result = await handleRegenerateDraft(env, id);
    return jsonResponse(result, result.ok ? 200 : 404);
  }

  if (url.pathname === '/api/admin/news-generate-selected' && request.method === 'POST') {
    let body;
    try {
      body = await request.json();
    } catch (error) {
      return jsonResponse({ message: '요청 내용을 확인해주세요.', userFriendly: true }, 400);
    }
    const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === 'string') : [];
    if (!ids.length) return jsonResponse({ message: '선택된 기사가 없습니다.', userFriendly: true }, 400);
    const result = await handleGenerateSelected(env, ids);
    return jsonResponse(result, 200);
  }

  if (url.pathname === '/api/admin/news-publish' && request.method === 'POST') {
    let body;
    try {
      body = await request.json();
    } catch (error) {
      return jsonResponse({ message: '요청 내용을 확인해주세요.', userFriendly: true }, 400);
    }
    const id = typeof body.id === 'string' ? body.id : '';
    if (!id) return jsonResponse({ message: 'id가 필요합니다.', userFriendly: true }, 400);
    const result = await publishNewsDraft(env, id, body.edited);
    return jsonResponse(result, result.ok ? 200 : 404);
  }

  if (url.pathname === '/api/admin/news-reject' && request.method === 'POST') {
    let body;
    try {
      body = await request.json();
    } catch (error) {
      return jsonResponse({ message: '요청 내용을 확인해주세요.', userFriendly: true }, 400);
    }
    const id = typeof body.id === 'string' ? body.id : '';
    const target = body.target === 'published' ? 'news:published' : 'news:drafts';
    if (!id) return jsonResponse({ message: 'id가 필요합니다.', userFriendly: true }, 400);
    const list = await getNewsList(env, target);
    const next = list.filter((item) => item.id !== id);
    await env.USAGE_KV.put(target, JSON.stringify(next));
    return jsonResponse({ ok: true, removed: list.length - next.length }, 200);
  }

  return jsonResponse({ message: 'Not found' }, 404);
}

async function handleMemberInfo(request, env) {
  const memberState = getMemberState(request);
  if (memberState.type !== 'free' || !env.USAGE_KV) {
    return jsonResponse({ firstSeen: null }, 200);
  }
  const raw = await env.USAGE_KV.get(`member:${memberState.userId}`);
  if (!raw) {
    return jsonResponse({ firstSeen: null }, 200);
  }
  try {
    const record = JSON.parse(raw);
    return jsonResponse({ firstSeen: record.firstSeen || null }, 200);
  } catch (error) {
    return jsonResponse({ firstSeen: null }, 200);
  }
}

async function handleMemberRegister(request, env) {
  const memberState = getMemberState(request);
  if (memberState.type !== 'free' || memberState.userId === 'anonymous') {
    return jsonResponse({ ok: false }, 200);
  }
  await recordMember(env, memberState, { countRequest: false });
  return jsonResponse({ ok: true }, 200);
}

async function recordMember(env, memberState, options = {}) {
  if (!env.USAGE_KV || memberState.type !== 'free') return;
  const countRequest = options.countRequest !== false;
  const key = `member:${memberState.userId}`;
  const now = new Date().toISOString();
  let existing = null;
  try {
    const raw = await env.USAGE_KV.get(key);
    existing = raw ? JSON.parse(raw) : null;
  } catch (error) {
    existing = null;
  }

  const record = {
    userId: memberState.userId,
    email: memberState.email || existing?.email || '',
    displayName: memberState.displayName || existing?.displayName || '',
    firstSeen: existing?.firstSeen || now,
    lastSeen: now,
    totalRequests: (existing?.totalRequests || 0) + (countRequest ? 1 : 0)
  };

  await env.USAGE_KV.put(key, JSON.stringify(record));
}

async function listKvMembers(env) {
  const members = [];
  let cursor;
  do {
    const page = await env.USAGE_KV.list({ prefix: 'member:', cursor });
    for (const item of page.keys) {
      const raw = await env.USAGE_KV.get(item.name);
      if (raw) {
        try {
          members.push(JSON.parse(raw));
        } catch (error) {}
      }
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);

  members.sort((a, b) => (b.lastSeen || '').localeCompare(a.lastSeen || ''));
  return members;
}

// Returns { members, integrated }. When a Firebase service account is configured,
// the member list is the full Firebase Authentication user list (so every signup
// shows, even without visiting), enriched with KV usage data. Otherwise it falls
// back to the KV-only list.
async function attachTodayUsage(env, members) {
  const date = getQuotaDate();
  return Promise.all(members.map(async (member) => {
    let todayUsage = 0;
    try {
      todayUsage = Number(await env.USAGE_KV.get(`usage:${date}:free:${member.userId}`)) || 0;
    } catch (error) {}
    return { ...member, todayUsage, dailyLimit: DAILY_LIMITS.free };
  }));
}

async function listMembers(env) {
  const kvMembers = await listKvMembers(env);

  let accessToken = null;
  try {
    accessToken = await getGoogleAccessToken(env);
  } catch (error) {
    console.error('[VN Boss Worker] access token failed:', error);
  }
  if (!accessToken) {
    return { members: await attachTodayUsage(env, kvMembers), integrated: false };
  }

  let firebaseUsers;
  try {
    firebaseUsers = await listFirebaseUsers(env, accessToken);
  } catch (error) {
    console.error('[VN Boss Worker] list Firebase users failed:', error);
    return { members: await attachTodayUsage(env, kvMembers), integrated: false };
  }

  const kvByUid = new Map(kvMembers.map((m) => [m.userId, m]));
  const merged = firebaseUsers.map((user) => {
    const kv = kvByUid.get(user.localId);
    const provider = (user.providerUserInfo && user.providerUserInfo[0]) || {};
    return {
      userId: user.localId,
      email: user.email || provider.email || '',
      displayName: (kv && kv.displayName) || user.displayName || provider.displayName || '',
      firstSeen: user.createdAt ? new Date(Number(user.createdAt)).toISOString() : (kv && kv.firstSeen) || '',
      lastSeen: user.lastLoginAt ? new Date(Number(user.lastLoginAt)).toISOString() : (kv && kv.lastSeen) || '',
      totalRequests: (kv && kv.totalRequests) || 0
    };
  });

  merged.sort((a, b) => (b.lastSeen || '').localeCompare(a.lastSeen || ''));
  return { members: await attachTodayUsage(env, merged), integrated: true };
}

async function recordErrorLog(env, entry) {
  if (!env.USAGE_KV) return;
  try {
    const raw = await env.USAGE_KV.get('admin:errors');
    const list = raw ? JSON.parse(raw) : [];
    list.unshift({ ...entry, at: new Date().toISOString() });
    await env.USAGE_KV.put('admin:errors', JSON.stringify(list.slice(0, MAX_ERROR_LOG_ENTRIES)));
  } catch (error) {
    console.error('[VN Boss Worker] Failed to record error log:', error);
  }
}

async function getErrorLog(env) {
  const raw = await env.USAGE_KV.get('admin:errors');
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch (error) {
    return [];
  }
}

// Accumulate estimated OpenAI spend from a response's usage object.
async function recordOpenAiUsage(env, model, usage, feature) {
  if (!env.USAGE_KV || !usage) return;
  const inTok = Number(usage.prompt_tokens) || 0;
  const outTok = Number(usage.completion_tokens) || 0;
  if (!inTok && !outTok) return;
  const price = OPENAI_PRICING[model] || OPENAI_PRICING_DEFAULT;
  const cost = (inTok / 1e6) * price.in + (outTok / 1e6) * price.out;
  const month = new Date().toISOString().slice(0, 7);

  let data;
  try {
    data = JSON.parse(await env.USAGE_KV.get('openai:usage') || 'null') || {};
  } catch (error) {
    data = {};
  }
  if (!data.total) data.total = { cost: 0, inTok: 0, outTok: 0 };
  if (!data.months) data.months = {};
  if (!data.months[month]) data.months[month] = { cost: 0, inTok: 0, outTok: 0, message: 0, news: 0 };

  data.total.cost += cost;
  data.total.inTok += inTok;
  data.total.outTok += outTok;
  const m = data.months[month];
  m.cost += cost;
  m.inTok += inTok;
  m.outTok += outTok;
  if (feature === 'message') m.message += cost;
  else m.news += cost;

  await env.USAGE_KV.put('openai:usage', JSON.stringify(data));
}

async function handleUsage(env) {
  const month = new Date().toISOString().slice(0, 7);
  let data;
  try {
    data = JSON.parse(await env.USAGE_KV.get('openai:usage') || 'null') || {};
  } catch (error) {
    data = {};
  }
  let balance = null;
  try {
    balance = JSON.parse(await env.USAGE_KV.get('openai:balance') || 'null');
  } catch (error) {
    balance = null;
  }
  const totalCost = data.total ? data.total.cost : 0;
  let balanceOut = null;
  if (balance) {
    const spentSince = totalCost - (balance.baseline || 0);
    balanceOut = { amount: balance.amount, remaining: balance.amount - spentSince, spentSince, setAt: balance.setAt };
  }
  return {
    total: data.total || { cost: 0, inTok: 0, outTok: 0 },
    thisMonth: data.months && data.months[month] ? data.months[month] : { cost: 0, inTok: 0, outTok: 0, message: 0, news: 0 },
    balance: balanceOut
  };
}

async function handleSetBalance(env, amount) {
  let data;
  try {
    data = JSON.parse(await env.USAGE_KV.get('openai:usage') || 'null') || {};
  } catch (error) {
    data = {};
  }
  const baseline = data.total ? data.total.cost : 0;
  const record = { amount: Number(amount) || 0, baseline, setAt: new Date().toISOString() };
  await env.USAGE_KV.put('openai:balance', JSON.stringify(record));
  return { ok: true };
}

function getOpenAIModel(env) {
  return typeof env.OPENAI_MODEL === 'string' && env.OPENAI_MODEL.trim()
    ? env.OPENAI_MODEL.trim()
    : DEFAULT_OPENAI_MODEL;
}

function getOpenAIChatEndpoint(env) {
  if (typeof env.AI_GATEWAY_OPENAI_CHAT_URL === 'string' && env.AI_GATEWAY_OPENAI_CHAT_URL.trim()) {
    return env.AI_GATEWAY_OPENAI_CHAT_URL.trim();
  }

  return DEFAULT_AI_GATEWAY_OPENAI_CHAT_URL;
}

function getMemberState(request) {
  const rawType = request.headers.get('X-VN-Boss-Member-State') || 'guest';
  const type = rawType === 'free' ? 'free' : 'guest';
  const rawUserId = request.headers.get('X-VN-Boss-User-Id') || '';
  const userId = rawUserId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || 'anonymous';
  const email = (request.headers.get('X-VN-Boss-Email') || '').slice(0, 200);
  const displayName = (request.headers.get('X-VN-Boss-Display-Name') || '').slice(0, 200);
  return { type, userId, email, displayName };
}

function getQuotaDate() {
  return new Date().toISOString().slice(0, 10);
}

function getQuotaKey(memberState) {
  return `usage:${getQuotaDate()}:${memberState.type}:${memberState.userId}`;
}

async function checkDailyQuota(env, memberState) {
  const limit = DAILY_LIMITS[memberState.type] ?? DAILY_LIMITS.guest;
  if (limit <= 0) {
    return { allowed: false, used: 0, limit, key: null, enforced: true };
  }

  if (!env.USAGE_KV) {
    return { allowed: true, used: 0, limit, key: null, enforced: false };
  }

  const key = getQuotaKey(memberState);
  const current = Number(await env.USAGE_KV.get(key)) || 0;
  return { allowed: current < limit, used: current, limit, key, enforced: true };
}

async function recordDailyQuota(env, quota) {
  if (!env.USAGE_KV || !quota.key) return;
  const nextValue = String((quota.used || 0) + 1);
  await env.USAGE_KV.put(quota.key, nextValue, { expirationTtl: 60 * 60 * 36 });
}

async function generateWithOpenAIChat(prompt, model, apiKey, gatewayUrl, env) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort('timeout'), OPENAI_TIMEOUT_MS);

  const payload = {
    model: `openai/${model}`,
    messages: [
      {
        role: 'system',
        content: [
          'You are VN Boss, an assistant for Korean F&B business owners in Vietnam.',
          'Return only valid JSON matching the schema: {"korean":"...","vietnamese":"..."}.',
          'Do not include markdown, explanations, comments, or extra keys.',
          'The Korean text must help the Korean owner review the message.',
          'The Vietnamese text must sound natural and clear for Vietnamese local staff.'
        ].join('\n')
      },
      { role: 'user', content: prompt }
    ],
    temperature: 0.35,
    max_tokens: 1200,
    response_format: { type: 'json_object' }
  };

  let response;
  let responseText = '';

  try {
    response = await fetch(gatewayUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    responseText = await response.text();
    console.log('[VN Boss Worker] AI Gateway response:', JSON.stringify({ status: response.status, ok: response.ok, bodyPreview: responseText.slice(0, 500) }));
  } catch (error) {
    if (error.name === 'AbortError' || error.message === 'timeout') {
      throw publicError('요청 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.', 504, error, 'OPENAI_TIMEOUT');
    }
    throw publicError('연결 오류가 발생했습니다. 잠시 후 다시 시도해주세요.', 503, error, 'OPENAI_NETWORK_ERROR');
  } finally {
    clearTimeout(timeoutId);
  }

  let data;
  try {
    data = responseText ? JSON.parse(responseText) : null;
  } catch (error) {
    console.error('[VN Boss Worker] OpenAI response parse failed:', responseText);
    throw publicError('응답을 읽지 못했습니다. 잠시 후 다시 시도해주세요.', 502, error, 'OPENAI_PARSE_FAILED');
  }

  if (!response.ok) {
    console.error('[VN Boss Worker] OpenAI Gateway Chat API error:', response.status, data);
    if (response.status === 400) throw publicError('OpenAI 요청 설정을 확인해주세요.', 400, null, 'OPENAI_BAD_REQUEST');
    if (response.status === 401) throw publicError('OpenAI API 키가 유효하지 않습니다.', 500, null, 'OPENAI_AUTH_401');
    if (response.status === 403) throw publicError('OpenAI 모델 권한 또는 프로젝트 권한을 확인해주세요.', 500, null, 'OPENAI_AUTH_403');
    if (response.status === 429) throw publicError('현재 이용량이 많습니다. 잠시 후 다시 시도해주세요.', 429, null, 'OPENAI_RATE_LIMITED');
    throw publicError('현재 이용량이 많습니다. 잠시 후 다시 시도해주세요.', 503, null, 'OPENAI_UPSTREAM_ERROR');
  }

  if (env) await recordOpenAiUsage(env, model, data?.usage, 'message');

  const content = data?.choices?.[0]?.message?.content || '';
  if (!content) {
    console.error('[VN Boss Worker] OpenAI response missing content:', data);
    throw publicError('응답 내용이 비어 있습니다. 잠시 후 다시 시도해주세요.', 502, null, 'OPENAI_EMPTY_CONTENT');
  }

  return parseNoticeJson(content);
}

function parseNoticeJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start > -1 && end > start) {
      parsed = JSON.parse(text.slice(start, end + 1));
    } else {
      throw publicError('응답 형식을 읽지 못했습니다. 다시 시도해주세요.', 502, error, 'NOTICE_JSON_PARSE_FAILED');
    }
  }

  if (!parsed || typeof parsed.korean !== 'string' || typeof parsed.vietnamese !== 'string') {
    console.error('[VN Boss Worker] Invalid structured output:', parsed);
    throw publicError('응답 형식을 읽지 못했습니다. 다시 시도해주세요.', 502, null, 'NOTICE_JSON_INVALID');
  }

  return {
    korean: parsed.korean.trim(),
    vietnamese: parsed.vietnamese.trim()
  };
}

function publicError(message, status, cause, code) {
  const error = new Error(message);
  error.publicMessage = message;
  error.publicStatus = status;
  if (code) error.publicCode = code;
  if (cause) error.cause = cause;
  return error;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
}

/* =========================================================================
 * Vietnam news feature
 * - Cron generates Korean-summarized drafts from 3 outlets' business RSS.
 * - Drafts require manual admin approval before appearing on the site.
 * ========================================================================= */

const NEWS_SOURCES = [
  { name: 'VnExpress', url: 'https://vnexpress.net/rss/kinh-doanh.rss' },
  { name: 'Tuoi Tre', url: 'https://tuoitre.vn/rss/kinh-doanh.rss' },
  { name: 'Thanh Nien', url: 'https://thanhnien.vn/rss/kinh-te.rss' }
];

// F&B and policy keywords (lowercase, Vietnamese). Matched against title+description.
const NEWS_KEYWORDS = [
  'nhà hàng', 'quán ăn', 'quán cà phê', 'cà phê', 'ẩm thực', 'thực phẩm', 'đồ uống',
  'đồ ăn', 'ăn uống', 'nhà hàng', 'bếp', 'f&b', 'đồ ăn nhanh', 'chuỗi',
  'chính sách', 'quy định', 'nghị định', 'thông tư', 'luật', 'thuế', 'giấy phép',
  'lương tối thiểu', 'an toàn thực phẩm', 'vệ sinh', 'lao động', 'doanh nghiệp nhỏ'
];

const NEWS_MAX_DRAFTS = 30;
const NEWS_MAX_PUBLISHED = 30;
const NEWS_MAX_SEEN = 250;
// Cheap model for ranking candidate headlines (one small call). Kept low-cost
// even if the summarization model is later upgraded.
const NEWS_RANK_MODEL = 'gpt-4o-mini';
// Stronger model for the actual summary (numbers/accuracy). News only; the
// member message generator stays on its own model.
const NEWS_SUMMARY_MODEL = 'gpt-4o';

async function getNewsList(env, key) {
  if (!env.USAGE_KV) return [];
  try {
    const raw = await env.USAGE_KV.get(key);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (error) {
    return [];
  }
}

function newsId() {
  return `n${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

function stripCdata(value) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function decodeXmlEntities(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function stripHtml(value) {
  return stripCdata(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractRssTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (!match) return '';
  return decodeXmlEntities(stripCdata(match[1]).trim());
}

function parseRssItems(xml, sourceName) {
  const items = [];
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = extractRssTag(block, 'title');
    const link = extractRssTag(block, 'link');
    const descriptionRaw = extractRssTag(block, 'description');
    const pubDate = extractRssTag(block, 'pubDate');
    if (!title || !link) continue;
    items.push({
      sourceName,
      title,
      link: link.trim(),
      description: stripHtml(descriptionRaw),
      pubDate
    });
  }
  return items;
}

function matchesNewsTopic(item) {
  const hay = `${item.title} ${item.description}`.toLowerCase();
  return NEWS_KEYWORDS.some((kw) => hay.includes(kw));
}

function extractArticleText(html) {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const paragraphs = [];
  const regex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let match;
  while ((match = regex.exec(cleaned)) !== null) {
    const text = decodeXmlEntities(match[1].replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length < 40) continue;
    if (/localStorage|function\s*\(|var\s|\{|\}|;\s*$/.test(text)) continue;
    paragraphs.push(text);
  }
  return paragraphs.join('\n').slice(0, 9000);
}

async function fetchArticleText(url) {
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VNBossBot/1.0)' } });
    if (!response.ok) return '';
    const html = await response.text();
    return extractArticleText(html);
  } catch (error) {
    console.error('[VN Boss Worker] article fetch failed:', error);
    return '';
  }
}

function dedupeByLink(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    if (seen.has(item.link)) continue;
    seen.add(item.link);
    result.push(item);
  }
  return result;
}

function shuffleInPlace(list) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// Try the strong summary model; if it errors (e.g. model not available on the
// account), fall back to gpt-4o-mini so generation never silently returns 0.
async function summarizeNewsItem(env, item, articleText) {
  try {
    return await callSummarize(env, item, articleText, NEWS_SUMMARY_MODEL);
  } catch (error) {
    console.error('[VN Boss Worker] summary model failed, falling back to gpt-4o-mini:', error);
    return await callSummarize(env, item, articleText, 'gpt-4o-mini');
  }
}

async function callSummarize(env, item, articleText, model) {
  const gatewayUrl = getOpenAIChatEndpoint(env);
  const payload = {
    model: `openai/${model}`,
    messages: [
      {
        role: 'system',
        content: '너는 베트남에서 사업하는 한국 F&B 사장님을 돕는 실무 컨설턴트다. 반드시 JSON만 반환한다. 본문에 실제로 있는 사실만 쓰고, 없는 수치·날짜·정책 내용은 절대 지어내지 않는다. 숫자와 금액은 특히 정확해야 한다. 막연하고 뻔한 표현("주의해야 한다", "관리가 중요하다")은 금지하고, 구체적인 상황과 예시로 설명한다.'
      },
      {
        role: 'user',
        content: [
          '다음 베트남 뉴스를 한국어로 정리해줘.',
          `제목(베트남어): ${item.title}`,
          `미리보기(베트남어): ${item.description || '(없음)'}`,
          `본문(베트남어): ${articleText || '(본문을 가져오지 못함 — 위 미리보기만 사용)'}`,
          '',
          '규칙:',
          '- 본문/미리보기에 실제로 있는 사실만 사용하고, 없는 내용은 지어내지 마라.',
          '- 숫자·금액 규칙(매우 중요, 틀리면 안 됨):',
          '   • 베트남어 숫자는 점(.)이 천 단위 구분, 쉼표(,)가 소수점이다. 예: "2.530.000 đồng"=2,530,000동, "0,35"=0.35.',
          '   • 베트남어 단위 변환: nghìn/ngàn=천, triệu=백만(=100만), tỷ=십억. 예: "50 triệu đồng"=5천만 동(50,000,000동), "885.500 đồng"=885,500동.',
          '   • triệu(백만)을 "만"으로, nghìn(천)을 "백"으로 절대 줄여 쓰지 마라. 금액은 동(VND) 값을 그대로 유지하고 변환을 한 번 더 검산하라.',
          '   • 기사에 요금 산정 공식·계수·기준금액·구체적 예시 금액이 있으면 summaryKo에 반드시 그대로 포함하라.',
          '- summaryKo: 기사 핵심을 4~6문장으로 정리(누가·무엇을·왜·핵심 수치·영향). 위 숫자 규칙을 지켜라.',
          '- policyChangeKo: 정책·규정·법·수수료·세금 등 "변경" 기사라면 변경 전과 후를 사실 그대로 대비해서 써라. 형식 예: "이전: ... / 변경 후: ...". 정책 변경이 아니거나 본문에 전/후가 명시되지 않았으면 빈 문자열("").',
          '- officialTextKo: 본문에 정부 공식 법령(법률·시행령·시행규칙·조문, 예: "Điều 18 Thông tư 78/2014/TT-BTC")의 실제 조문 텍스트가 인용되어 있으면, 그 "조문 자체"만 한국어로 정확하고 충실하게 번역해 넣어라. 기자의 해설·설명·요약 문장은 절대 포함하지 말고, 인용된 법 조문 원문만 번역한다. 조문 앞에 어떤 법령의 몇 조인지 표기하라(예: "[시행규칙 78/2014/TT-BTC 제18조]"). 법령 조문 인용이 없으면 빈 문자열("").',
          '- ownerPointKo: 절대 한 문장으로 뭉뚱그리지 마라. 반드시 아래 3가지를 각각 구체적으로 써라(총 4~6문장, 문단):',
          '   (1) 문제 상황 예시: 이 사안에서 어떤 사장님이 어떤 구체적 상황에서 어떤 손해·불이익·리스크를 겪는지 실제 시나리오 1개를 든다.',
          '   (2) 왜 그런지: 규정·조건·수치 등 근거를 짧게.',
          '   (3) 구체적 행동: 당장 무엇을 어떻게 점검·준비할지(서류·절차·확인 항목 등 실행 가능한 조치).',
          '   [나쁜 예 — 이렇게 쓰면 실패]: "부동산 거래 시 세금 혜택을 고려하여 투자 계획을 세우는 것이 중요하다."',
          '   [좋은 예]: "예를 들어 매장을 여러 개 운영하는 사장님이 A매장은 세제 혜택 대상, B매장은 비대상인데 수익을 구분 기장하지 않으면 전체가 혜택에서 배제돼 예상보다 높은 법인세를 낼 수 있다. 시행규칙상 혜택 사업과 비혜택 사업의 수익·비용을 분리 신고해야 하기 때문이다. 따라서 매장·사업별로 매출과 비용을 분리 기장하고, 회계 담당자에게 항목별 혜택 대상 여부를 확인받아 두는 것이 좋다."',
          '   금지 표현: "중요하다", "고려해야 한다", "주의가 필요하다", "잘 관리해야 한다", "세우는 것이 좋다" 같은 막연한 마무리.',
          '- discussionKo: 사장님들이 댓글로 서로 의견을 나누고 싶어지도록 던지는 열린 질문 1~2문장. 이 뉴스 주제와 직접 연결된 실제 고민이어야 한다. 예: "여러분은 거래처 세금계산서를 어떻게 검증하시나요?"',
          '',
          '아래 JSON 형식으로만 답해:',
          '{"titleKo":"자연스러운 한국어 제목","summaryKo":"","policyChangeKo":"","officialTextKo":"","ownerPointKo":"","discussionKo":""}'
        ].join('\n')
      }
    ],
    temperature: 0.4,
    max_tokens: 2000,
    response_format: { type: 'json_object' }
  };

  const response = await fetch(gatewayUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  if (!response.ok) throw new Error(`news summarize failed: ${response.status} ${text.slice(0, 200)}`);
  const data = JSON.parse(text);
  await recordOpenAiUsage(env, model, data.usage, 'news');
  const content = data?.choices?.[0]?.message?.content || '';
  const parsed = JSON.parse(content);
  return {
    titleKo: String(parsed.titleKo || '').trim(),
    summaryKo: String(parsed.summaryKo || '').trim(),
    policyChangeKo: String(parsed.policyChangeKo || '').trim(),
    officialTextKo: String(parsed.officialTextKo || '').trim(),
    ownerPointKo: String(parsed.ownerPointKo || '').trim(),
    discussionKo: String(parsed.discussionKo || '').trim(),
    usedModel: model
  };
}

// Fetch + keyword-filter + dedupe candidates. RSS only, no API cost.
async function fetchNewsCandidates(env) {
  let all = [];
  for (const src of NEWS_SOURCES) {
    try {
      const res = await fetch(src.url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VNBossBot/1.0)' } });
      if (!res.ok) continue;
      const xml = await res.text();
      all = all.concat(parseRssItems(xml, src.name));
    } catch (error) {
      console.error('[VN Boss Worker] news fetch failed:', src.name, error);
    }
  }
  const seen = new Set(await getNewsList(env, 'news:seen'));
  return dedupeByLink(all.filter(matchesNewsTopic)).filter((item) => !seen.has(item.link));
}

async function summarizeToDraft(env, item) {
  const articleText = await fetchArticleText(item.link);
  const summary = await summarizeNewsItem(env, item, articleText);
  if (!summary.titleKo || !summary.summaryKo) return null;
  return {
    id: newsId(),
    sourceName: item.sourceName,
    link: item.link,
    pubDate: item.pubDate || '',
    srcTitle: item.title || '',
    srcDesc: item.description || '',
    titleKo: summary.titleKo,
    summaryKo: summary.summaryKo,
    policyChangeKo: summary.policyChangeKo,
    officialTextKo: summary.officialTextKo,
    ownerPointKo: summary.ownerPointKo,
    discussionKo: summary.discussionKo,
    usedModel: summary.usedModel || '',
    createdAt: new Date().toISOString()
  };
}

// Re-summarize an existing draft in place (same id/position) with current code.
async function handleRegenerateDraft(env, id) {
  const drafts = await getNewsList(env, 'news:drafts');
  const idx = drafts.findIndex((d) => d.id === id);
  if (idx === -1) return { ok: false, message: '초안을 찾을 수 없습니다.' };
  const target = drafts[idx];
  const item = {
    title: target.srcTitle || '',
    description: target.srcDesc || '',
    link: target.link,
    sourceName: target.sourceName,
    pubDate: target.pubDate || ''
  };
  const fresh = await summarizeToDraft(env, item);
  if (!fresh) return { ok: false, message: '재생성에 실패했습니다.' };
  fresh.id = target.id;
  drafts[idx] = fresh;
  await env.USAGE_KV.put('news:drafts', JSON.stringify(drafts));
  return { ok: true, created: 1 };
}

async function saveDraftsAndSeen(env, drafts, links) {
  if (!drafts.length) return;
  const existing = await getNewsList(env, 'news:drafts');
  const merged = drafts.concat(existing).slice(0, NEWS_MAX_DRAFTS);
  await env.USAGE_KV.put('news:drafts', JSON.stringify(merged));
  const seenList = await getNewsList(env, 'news:seen');
  const nextSeen = links.concat(seenList).slice(0, NEWS_MAX_SEEN);
  await env.USAGE_KV.put('news:seen', JSON.stringify(nextSeen));
}

// Rank candidates by relevance for Korean F&B owners using a cheap model.
// One small API call regardless of candidate count. Returns candidates ordered
// best-first, each with a short Korean reason. Falls back to original order.
async function rankCandidates(env, candidates) {
  const top = candidates.slice(0, 25);
  if (top.length <= 1) return top.map((c) => ({ ...c, reasonKo: '' }));

  const listText = top.map((c, i) => `${i + 1}. ${c.title} — ${(c.description || '').slice(0, 120)}`).join('\n');
  const payload = {
    model: `openai/${NEWS_RANK_MODEL}`,
    messages: [
      { role: 'system', content: '너는 베트남에서 사업하는 한국 F&B(요식업) 사장님에게 실질적으로 중요한 뉴스를 골라주는 편집자다. 세금·정책·인허가·노무·식품안전·임대·비용 등 사장님이 대응해야 하는 실무 뉴스를 높게 평가한다. 반드시 JSON만 반환한다.' },
      { role: 'user', content: [
        '다음 베트남 뉴스 후보 목록에서 한국 F&B 사장님에게 중요한 순서로 최대 10개를 골라라.',
        listText,
        '',
        'JSON 형식으로만: {"picks":[{"index":번호,"reasonKo":"왜 중요한지 한 줄"}]}. index는 위 번호. 관련성 낮은 것은 제외.'
      ].join('\n') }
    ],
    temperature: 0.2,
    max_tokens: 900,
    response_format: { type: 'json_object' }
  };

  try {
    const res = await fetch(getOpenAIChatEndpoint(env), {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`rank failed ${res.status}`);
    const data = JSON.parse(text);
    await recordOpenAiUsage(env, NEWS_RANK_MODEL, data.usage, 'news');
    const parsed = JSON.parse(data?.choices?.[0]?.message?.content || '{}');
    const picks = Array.isArray(parsed.picks) ? parsed.picks : [];
    const ordered = [];
    for (const p of picks) {
      const idx = Number(p.index) - 1;
      if (idx >= 0 && idx < top.length) {
        ordered.push({ ...top[idx], reasonKo: String(p.reasonKo || '').trim() });
      }
    }
    return ordered.length ? ordered : top.map((c) => ({ ...c, reasonKo: '' }));
  } catch (error) {
    console.error('[VN Boss Worker] rank failed:', error);
    return top.map((c) => ({ ...c, reasonKo: '' }));
  }
}

// Admin: fetch + rank candidates (cheap), store them for later selection.
async function handleNewsCandidates(env) {
  if (!env.USAGE_KV) return { ok: false, reason: 'KV_NOT_BOUND', candidates: [] };
  if (!env.OPENAI_API_KEY) return { ok: false, reason: 'OPENAI_KEY_MISSING', candidates: [] };
  const candidates = await fetchNewsCandidates(env);
  if (!candidates.length) {
    await env.USAGE_KV.put('news:candidates', JSON.stringify([]));
    return { ok: true, candidates: [], note: '조건에 맞는 새 기사가 없습니다.' };
  }
  const ranked = await rankCandidates(env, candidates);
  const withIds = ranked.map((c) => ({
    id: newsId2(),
    title: c.title,
    description: c.description || '',
    sourceName: c.sourceName,
    link: c.link,
    pubDate: c.pubDate || '',
    reasonKo: c.reasonKo || ''
  }));
  await env.USAGE_KV.put('news:candidates', JSON.stringify(withIds));
  return { ok: true, candidates: withIds };
}

// Admin: summarize ONLY the selected candidates (this is where API cost is spent).
async function handleGenerateSelected(env, ids) {
  if (!env.USAGE_KV) return { ok: false, reason: 'KV_NOT_BOUND', created: 0 };
  if (!env.OPENAI_API_KEY) return { ok: false, reason: 'OPENAI_KEY_MISSING', created: 0 };
  const stored = await getNewsList(env, 'news:candidates');
  const selected = stored.filter((c) => ids.includes(c.id));
  if (!selected.length) return { ok: true, created: 0, note: '선택된 기사가 없습니다.' };

  const drafts = [];
  const links = [];
  const errors = [];
  for (const item of selected) {
    try {
      const draft = await summarizeToDraft(env, item);
      if (draft) {
        drafts.push(draft);
        links.push(item.link);
      } else {
        errors.push('요약 결과가 비었습니다: ' + (item.title || '').slice(0, 40));
      }
    } catch (error) {
      console.error('[VN Boss Worker] selected summarize failed:', error);
      errors.push(String((error && error.message) || error).slice(0, 200));
    }
  }
  await saveDraftsAndSeen(env, drafts, links);
  const usedModels = Array.from(new Set(drafts.map((d) => d.usedModel).filter(Boolean)));
  return { ok: true, created: drafts.length, usedModels, errors };
}

// Legacy random auto-generation (kept for manual "random" button / fallback).
async function generateNewsDrafts(env) {
  if (!env.USAGE_KV) return { ok: false, reason: 'KV_NOT_BOUND', created: 0 };
  if (!env.OPENAI_API_KEY) return { ok: false, reason: 'OPENAI_KEY_MISSING', created: 0 };

  const count = 2 + Math.floor(Math.random() * 2); // 2 or 3
  const candidates = await fetchNewsCandidates(env);
  if (!candidates.length) return { ok: true, created: 0, note: '조건에 맞는 새 기사가 없습니다.' };

  shuffleInPlace(candidates);
  const picks = candidates.slice(0, count);
  const drafts = [];
  const links = [];
  for (const item of picks) {
    try {
      const draft = await summarizeToDraft(env, item);
      if (draft) {
        drafts.push(draft);
        links.push(item.link);
      }
    } catch (error) {
      console.error('[VN Boss Worker] summarize failed:', error);
    }
  }
  await saveDraftsAndSeen(env, drafts, links);
  return { ok: true, created: drafts.length };
}

async function publishNewsDraft(env, id, edited) {
  const drafts = await getNewsList(env, 'news:drafts');
  const target = drafts.find((item) => item.id === id);
  if (!target) return { ok: false, message: '초안을 찾을 수 없습니다.' };

  const entry = {
    ...target,
    titleKo: edited && typeof edited.titleKo === 'string' && edited.titleKo.trim() ? edited.titleKo.trim() : target.titleKo,
    summaryKo: edited && typeof edited.summaryKo === 'string' && edited.summaryKo.trim() ? edited.summaryKo.trim() : target.summaryKo,
    ownerPointKo: edited && typeof edited.ownerPointKo === 'string' ? edited.ownerPointKo.trim() : target.ownerPointKo,
    publishedAt: new Date().toISOString()
  };

  const published = await getNewsList(env, 'news:published');
  const nextPublished = [entry].concat(published.filter((item) => item.id !== id)).slice(0, NEWS_MAX_PUBLISHED);
  const nextDrafts = drafts.filter((item) => item.id !== id);

  await env.USAGE_KV.put('news:published', JSON.stringify(nextPublished));
  await env.USAGE_KV.put('news:drafts', JSON.stringify(nextDrafts));

  return { ok: true, message: '게시되었습니다.' };
}

/* ---- News comments (members can comment on published news) ---- */

const COMMENT_MAX_LEN = 500;
const COMMENT_MAX_PER_NEWS = 300;

function sanitizeNewsId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 40);
}

function getBearerToken(request) {
  const authHeader = request.headers.get('Authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

async function handleGetComments(env, url) {
  if (!env.USAGE_KV) return jsonResponse({ comments: [] }, 200);
  const newsId = sanitizeNewsId(url.searchParams.get('newsId'));
  if (!newsId) return jsonResponse({ comments: [] }, 200);
  const comments = await getNewsList(env, `comments:${newsId}`);
  return jsonResponse({ comments }, 200);
}

async function handleAddComment(request, env) {
  if (!env.USAGE_KV) {
    return jsonResponse({ message: '저장소가 연결되지 않았습니다.', userFriendly: true }, 500);
  }
  const payload = await verifyFirebaseIdToken(getBearerToken(request));
  if (!payload) {
    return jsonResponse({ message: '댓글은 로그인 후 작성할 수 있습니다.', userFriendly: true, code: 'AUTH_REQUIRED' }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch (error) {
    return jsonResponse({ message: '요청 내용을 확인해주세요.', userFriendly: true }, 400);
  }

  const newsId = sanitizeNewsId(body.newsId);
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, COMMENT_MAX_LEN) : '';
  if (!newsId || !text) {
    return jsonResponse({ message: '댓글 내용을 입력해주세요.', userFriendly: true }, 400);
  }

  const published = await getNewsList(env, 'news:published');
  if (!published.some((item) => item.id === newsId)) {
    return jsonResponse({ message: '뉴스를 찾을 수 없습니다.', userFriendly: true }, 404);
  }

  const key = `comments:${newsId}`;
  const list = await getNewsList(env, key);
  const comment = {
    id: newsId2(),
    userId: payload.user_id || payload.sub || '',
    displayName: String(payload.name || payload.email || '회원').slice(0, 40),
    text,
    createdAt: new Date().toISOString()
  };
  const next = list.concat([comment]).slice(-COMMENT_MAX_PER_NEWS);
  await env.USAGE_KV.put(key, JSON.stringify(next));
  return jsonResponse({ ok: true, comment }, 200);
}

async function handleDeleteComment(request, env) {
  if (!env.USAGE_KV) {
    return jsonResponse({ message: '저장소가 연결되지 않았습니다.', userFriendly: true }, 500);
  }
  const payload = await verifyFirebaseIdToken(getBearerToken(request));
  if (!payload) {
    return jsonResponse({ message: '로그인 후 이용해주세요.', userFriendly: true, code: 'AUTH_REQUIRED' }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch (error) {
    return jsonResponse({ message: '요청 내용을 확인해주세요.', userFriendly: true }, 400);
  }

  const newsId = sanitizeNewsId(body.newsId);
  const commentId = typeof body.commentId === 'string' ? body.commentId : '';
  if (!newsId || !commentId) {
    return jsonResponse({ message: '잘못된 요청입니다.', userFriendly: true }, 400);
  }

  const key = `comments:${newsId}`;
  const list = await getNewsList(env, key);
  const target = list.find((item) => item.id === commentId);
  if (!target) {
    return jsonResponse({ message: '댓글을 찾을 수 없습니다.', userFriendly: true }, 404);
  }

  const uid = payload.user_id || payload.sub || '';
  const isAdmin = getAdminEmails(env).includes((payload.email || '').toLowerCase());
  if (target.userId !== uid && !isAdmin) {
    return jsonResponse({ message: '본인 댓글만 삭제할 수 있습니다.', userFriendly: true }, 403);
  }

  const next = list.filter((item) => item.id !== commentId);
  await env.USAGE_KV.put(key, JSON.stringify(next));
  return jsonResponse({ ok: true }, 200);
}

function newsId2() {
  return `c${Date.now()}${Math.floor(Math.random() * 100000)}`;
}





