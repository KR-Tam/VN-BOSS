const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const DEFAULT_AI_GATEWAY_OPENAI_CHAT_URL = 'https://gateway.ai.cloudflare.com/v1/bd0c3fba48bff8f5bec8f88cd625c719/vnboss-gateway/compat/chat/completions';
const DEFAULT_AI_GATEWAY_ACCOUNT_ID = 'bd0c3fba48bff8f5bec8f88cd625c719';
const DEFAULT_AI_GATEWAY_ID = 'vnboss-gateway';
const OPENAI_TIMEOUT_MS = 45000;

const DAILY_LIMITS = {
  guest: 0,
  free: 10
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-VN-Boss-Member-State, X-VN-Boss-User-Id',
  'Access-Control-Max-Age': '86400'
};

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    korean: {
      type: 'string',
      description: 'Korean review version for the business owner.'
    },
    vietnamese: {
      type: 'string',
      description: 'Natural Vietnamese workplace notice for local staff.'
    }
  },
  required: ['korean', 'vietnamese'],
  additionalProperties: false
};

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
  const quota = await checkDailyQuota(env, memberState);
  console.log('[VN Boss Worker] quota check:', JSON.stringify({ memberType: memberState.type, userId: memberState.userId, allowed: quota.allowed, used: quota.used, limit: quota.limit }));
  if (!quota.allowed) {
    console.warn('[VN Boss Worker] request blocked before AI Gateway:', JSON.stringify({ memberType: memberState.type, quota }));
    return jsonResponse({
      message: memberState.type === 'guest'
        ? 'API 보호를 위해 비회원 AI 작성은 제공하지 않습니다. 무료 회원으로 시작하면 하루 10회까지 사용할 수 있습니다.'
        : '오늘의 무료 회원 AI 사용량을 모두 사용했습니다. 내일 다시 이용해주세요.',
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
    const message = error.publicMessage || '현재 AI 이용량이 많습니다. 잠시 후 다시 시도해주세요.';
    return jsonResponse({ message, userFriendly: true, code: error.publicCode || 'AI_REQUEST_FAILED' }, status);
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
  return { type, userId };
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
    model,
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
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'vn_boss_notice',
        strict: true,
        schema: OUTPUT_SCHEMA
      }
    }
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
    throw publicError('현재 AI 이용량이 많습니다. 잠시 후 다시 시도해주세요.', 503, null, 'OPENAI_UPSTREAM_ERROR');
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





