const FREE_MODEL_FALLBACKS = [
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-3-flash',
  'gemini-3.5-flash'
];

const MAX_MODELS_PER_REQUEST = 3;
const MODEL_TIMEOUT_MS = 15000;
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

    const url = new URL(request.url);
    if (url.pathname !== '/api/generate') {
      return jsonResponse({ message: 'Not found' }, 404);
    }

    if (request.method !== 'POST') {
      return jsonResponse({ message: 'Method not allowed' }, 405);
    }

    if (!env.GEMINI_API_KEY) {
      return jsonResponse({ message: 'Server configuration is missing.' }, 500);
    }

    let body;
    try {
      body = await request.json();
    } catch (error) {
      return jsonResponse({ message: 'Invalid request body.' }, 400);
    }

    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    if (!prompt) {
      return jsonResponse({ message: 'Prompt is required.' }, 400);
    }

    try {
      const result = await generateWithFallback(prompt, env.GEMINI_API_KEY);
      return jsonResponse(result, 200);
    } catch (error) {
      const status = error.publicStatus || 503;
      const message = error.publicMessage || '현재 AI 이용량이 많습니다. 잠시 후 다시 시도해주세요.';
      return jsonResponse({ message, userFriendly: true }, status);
    }
  }
};

async function generateWithFallback(prompt, apiKey) {
  let lastError = null;
  const modelsToTry = FREE_MODEL_FALLBACKS.slice(0, MAX_MODELS_PER_REQUEST);

  for (const model of modelsToTry) {
    try {
      console.log('[VN Boss Worker] trying model:', model);
      const result = await callGeminiModel(prompt, model, apiKey);
      console.log('[VN Boss Worker] model succeeded:', model);
      return normalizeModelResponse(result);
    } catch (error) {
      lastError = error;
      logModelFailure(model, error);
      if (shouldStopImmediately(error) || !shouldTryNextModel(error)) throw toPublicError(error);

      if (error.status === 503) {
        await wait(3000);
        try {
          console.log('[VN Boss Worker] retrying model:', model);
          const retryResult = await callGeminiModel(prompt, model, apiKey);
          console.log('[VN Boss Worker] model succeeded after retry:', model);
          return normalizeModelResponse(retryResult);
        } catch (retryError) {
          lastError = retryError;
          logModelFailure(model, retryError);
          if (shouldStopImmediately(retryError) || !shouldTryNextModel(retryError)) throw toPublicError(retryError);
        }
      }
    }
  }

  throw toCapacityError(lastError);
}

async function callGeminiModel(prompt, model, apiKey) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort('timeout'), MODEL_TIMEOUT_MS);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.35,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          korean: { type: 'STRING' },
          vietnamese: { type: 'STRING' }
        },
        required: ['korean', 'vietnamese']
      }
    }
  };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const responseText = await response.text();
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      error.responseText = responseText;
      error.model = model;
      throw error;
    }

    try {
      return JSON.parse(responseText);
    } catch (error) {
      const parseError = new Error('Model response parse failed.');
      parseError.status = 502;
      parseError.responseText = responseText;
      parseError.model = model;
      throw parseError;
    }
  } catch (error) {
    if (error.name === 'AbortError' || error.message === 'timeout') {
      const timeoutError = new Error('Timeout');
      timeoutError.status = 'timeout';
      timeoutError.isTimeout = true;
      timeoutError.model = model;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizeModelResponse(data) {
  if (data && typeof data.korean === 'string' && typeof data.vietnamese === 'string') return data;

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!text) throw Object.assign(new Error('Empty model response.'), { status: 502 });

  try {
    return JSON.parse(text);
  } catch (error) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start > -1 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw Object.assign(new Error('Invalid model response.'), { status: 502 });
  }
}

function isResourceExhausted(error) {
  const text = `${error?.message || ''}\n${error?.responseText || ''}`;
  return text.includes('RESOURCE_EXHAUSTED');
}

function shouldTryNextModel(error) {
  return error?.status === 429 || error?.status === 503 || error?.isTimeout === true || isResourceExhausted(error);
}

function shouldStopImmediately(error) {
  if (isResourceExhausted(error)) return false;
  return error?.status === 400 || error?.status === 401 || error?.status === 403;
}

function logModelFailure(model, error) {
  const status = error?.isTimeout ? 'timeout' : error?.status || 'unknown';
  console.warn('[VN Boss Worker] model failed:', model, 'status:', status);
}

function toCapacityError(error) {
  const finalError = new Error('Capacity exceeded.');
  finalError.cause = error;
  finalError.publicStatus = 503;
  finalError.publicMessage = '현재 AI 이용량이 많습니다. 잠시 후 다시 시도해주세요.';
  return finalError;
}

function toPublicError(error) {
  if (error.status === 401 || error.status === 403) {
    const publicError = new Error('Configuration rejected.');
    publicError.publicStatus = 500;
    publicError.publicMessage = '연결 준비가 필요합니다.';
    return publicError;
  }

  if (error.status === 400) {
    const publicError = new Error('Bad request.');
    publicError.publicStatus = 400;
    publicError.publicMessage = '요청 내용을 확인해주세요.';
    return publicError;
  }

  return toCapacityError(error);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
