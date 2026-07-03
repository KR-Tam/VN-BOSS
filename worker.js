const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const DEFAULT_AI_GATEWAY_OPENAI_CHAT_URL = 'https://gateway.ai.cloudflare.com/v1/bd0c3fba48bff8f5bec8f88cd625c719/vnboss-gateway/compat/chat/completions';
const DEFAULT_AI_GATEWAY_ACCOUNT_ID = 'bd0c3fba48bff8f5bec8f88cd625c719';
const DEFAULT_AI_GATEWAY_ID = 'vnboss-gateway';
const OPENAI_TIMEOUT_MS = 45000;

// Admin access is gated on a verified Firebase Google login, not a shared secret.
const FIREBASE_PROJECT_ID = 'vn-boss';
const ADMIN_EMAILS = ['sirisiri1148@gmail.com'];
const FIREBASE_JWK_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let cachedFirebaseJwks = null;
let cachedFirebaseJwksExpiry = 0;

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
    const result = await generateWithOpenAIChat(prompt, model, env.OPENAI_API_KEY, gatewayUrl);
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
    const members = await listMembers(env);
    return jsonResponse({ members }, 200);
  }

  if (url.pathname === '/api/admin/errors' && request.method === 'GET') {
    const errors = await getErrorLog(env);
    return jsonResponse({ errors }, 200);
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

async function recordMember(env, memberState) {
  if (!env.USAGE_KV || memberState.type !== 'free') return;
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
    totalRequests: (existing?.totalRequests || 0) + 1
  };

  await env.USAGE_KV.put(key, JSON.stringify(record));
}

async function listMembers(env) {
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

async function generateWithOpenAIChat(prompt, model, apiKey, gatewayUrl) {
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





