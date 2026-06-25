const form = document.querySelector('#noticeForm');
const koreanResult = document.querySelector('#koreanResult');
const vietnameseResult = document.querySelector('#vietnameseResult');
const statusBox = document.querySelector('#statusBox');
const generateButton = document.querySelector('#generateButton');
const targetSelect = document.querySelector('#target');
const targetCustomWrap = document.querySelector('#targetCustomWrap');
const targetCustomInput = document.querySelector('#targetCustom');
const useDeadlineCheck = document.querySelector('#useDeadline');
const deadlineFields = document.querySelector('#deadlineFields');
const deadlineDate = document.querySelector('#deadlineDate');
const deadlineTime = document.querySelector('#deadlineTime');
let messageRequestInProgress = false;

const REQUEST_TIMEOUT_MS = 60000;

const toneGuide = {
  '부드럽게': '정중하고 협조를 요청하는 표현을 사용한다. 압박감은 낮추되 해야 할 일은 분명히 쓴다.',
  '기본': '간결하고 명확한 업무 공지 톤을 사용한다. 감정 표현보다 실행 기준을 우선한다.',
  '강하게': '반드시 지켜야 하는 기준과 책임을 분명히 쓴다. 모욕적이거나 위협적인 표현은 쓰지 않는다.'
};

const typeGuide = {
  '업무 요청': '해야 할 업무, 완료 기준, 마감일을 분명히 정리한다.',
  '점검 요청': '확인해야 할 항목, 점검 기준, 이상 발견 시 조치 방향을 강조한다.',
  '일정 안내': '일정, 준비 사항, 참여 또는 확인 필요 사항을 명확히 안내한다.',
  '안내': '직원이 알아야 할 기준, 일정, 절차를 쉽고 명확하게 안내한다.',
  '경고': '문제 상황과 지켜야 할 기준을 단호하게 알리되 인신공격 없이 작성한다.',
  '재발방지': '문제 재발을 막기 위한 구체적 조치와 확인 절차를 포함한다.',
  '개선 요청': '현재 문제를 개선하기 위한 구체적인 행동과 앞으로의 기준을 분명히 정리한다.'
};

function pad(value) {
  return String(value).padStart(2, '0');
}

function todayString() {
  const today = new Date();
  return `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
}

function formatKoreanDeadline(dateValue, timeValue) {
  return `${dateValue} ${timeValue}`;
}

function formatVietnameseDeadline(dateValue, timeValue) {
  const [year, month, day] = dateValue.split('-');
  return `${day}/${month}/${year} ${timeValue}`;
}

function updateDeadlineVisibility() {
  if (!useDeadlineCheck || !deadlineFields) return;
  deadlineFields.style.display = useDeadlineCheck.checked ? 'grid' : 'none';
}


function updateTargetCustomVisibility() {
  if (!targetSelect || !targetCustomWrap || !targetCustomInput) return;
  const isCustom = targetSelect.value === 'custom';
  targetCustomWrap.style.display = isCustom ? 'grid' : 'none';
  if (!isCustom) targetCustomInput.value = '';
}

function getSelectedTarget() {
  if (!targetSelect) return '';
  if (targetSelect.value !== 'custom') return targetSelect.value;
  return targetCustomInput ? targetCustomInput.value.trim() : '';
}
function getNoticeInputs() {
  const useDeadline = useDeadlineCheck ? useDeadlineCheck.checked : false;
  const deadline = useDeadline ? formatKoreanDeadline(deadlineDate.value, deadlineTime.value) : '';
  const deadlineVietnamese = useDeadline ? formatVietnameseDeadline(deadlineDate.value, deadlineTime.value) : '';

  return {
    target: getSelectedTarget(),
    noticeType: document.querySelector('#noticeType').value,
    tone: document.querySelector('#tone').value,
    task: document.querySelector('#task').value.trim(),
    useDeadline,
    deadline,
    deadlineVietnamese
  };
}

function normalizeNoticeInputs(input) {
  return {
    target: input.target,
    noticeType: input.noticeType,
    tone: input.tone,
    task: input.task || '[업무 내용 미입력]',
    useDeadline: input.useDeadline === true,
    deadline: input.useDeadline ? input.deadline : '',
    deadlineVietnamese: input.useDeadline ? input.deadlineVietnamese : ''
  };
}

function buildNoticePrompt(input) {
  const data = normalizeNoticeInputs(input);
  const deadlineInput = data.useDeadline
    ? `- Deadline for Korean notice: ${data.deadline}\n- Deadline for Vietnamese notice: ${data.deadlineVietnamese}`
    : '- Deadline: not specified';
  const koreanDeadlineRule = data.useDeadline
    ? `- Include the deadline exactly as: 마감일: ${data.deadline}`
    : '- Do not include any deadline item or deadline sentence.';
  const vietnameseDeadlineRule = data.useDeadline
    ? `- Include the deadline exactly as: Thời hạn: ${data.deadlineVietnamese}`
    : '- Do not include any deadline item or deadline sentence.';

  return `You are VN Boss, an assistant that helps Korean business owners in Vietnam write clear workplace notices for Vietnamese local staff.

Goal:
Create high-quality workplace notice content from the provided Korean business input. The notice must be practical, respectful, and easy for Vietnamese employees to understand.

Input values:
- Target audience: ${data.target}
- Notice type: ${data.noticeType}
- Tone: ${data.tone}
- Task detail: ${data.task}
${deadlineInput}

Context:
- The sender is a Korean business owner or manager operating in Vietnam.
- The receivers are Vietnamese local staff.
- The content is for workplace communication, not marketing copy.
- Avoid vague, decorative, or overly formal language.
- Use clear action-oriented wording.

Notice type guidance:
${typeGuide[data.noticeType]}

Tone guidance:
${toneGuide[data.tone]}

Output requirements:
Return ONLY valid JSON. Do not include markdown fences, explanations, comments, or extra keys.
The JSON object must have exactly these keys:
{
  "korean": "...",
  "vietnamese": "..."
}

1. korean:
- Write an organized Korean notice for the Korean owner to review.
- Include title, 대상, 핵심 요청, 유의사항.
${koreanDeadlineRule}
- Keep it concise but complete.

2. vietnamese:
- Write a natural Vietnamese workplace notice for local Vietnamese staff.
- The notice should work naturally when copied into common work communication channels, chat tools, or email.
- Preserve all key information from the input.
- Make the requested action clear.
${vietnameseDeadlineRule}
- Do not sound like machine translation.
- Do not add facts that are not provided.

Quality rules:
- Do not invent policy, punishment, salary, legal, HR details, or deadlines.
- If the tone is strong, be firm but not insulting or threatening.
- If the notice type is warning or recurrence prevention, focus on behavior and process, not personal blame.
- Use consistent meaning across Korean and Vietnamese versions.
- If an input field is missing, write a neutral placeholder request instead of making up details.

Now generate the JSON response based only on the input values above.`;
}

function getConfigStatus() {
  const loaded = window.VN_BOSS_CONFIG_LOADED === true;
  const config = window.VN_BOSS_CONFIG || {};
  const endpoint = typeof config.API_ENDPOINT === 'string' && config.API_ENDPOINT.trim() ? config.API_ENDPOINT.trim() : '/api/generate';
  return { loaded, endpoint };
}

function formatConnectionError() {
  return '연결 오류:\n잠시 후 다시 시도해주세요.';
}

function setStatus(message, type = '') {
  statusBox.textContent = message || '';
  statusBox.className = `status-box${message ? ' show' : ''}${type ? ` ${type}` : ''}`;
}

function setLoading(isLoading) {
  generateButton.disabled = isLoading;
  generateButton.textContent = isLoading ? '잠시만 기다려주세요.' : '메시지 작성';
}

function renderResult(result) {
  koreanResult.textContent = result.korean;
  vietnameseResult.textContent = result.vietnamese;
  koreanResult.classList.remove('empty');
  vietnameseResult.classList.remove('empty');
}

function showRawResponse(raw) {
  koreanResult.textContent = '응답 형식을 확인해야 합니다. 아래 원문 응답을 확인해 주세요.';
  vietnameseResult.textContent = raw || '원문 응답이 비어 있습니다.';
  koreanResult.classList.remove('empty');
  vietnameseResult.classList.remove('empty');
}

function parseGenerateResult(data) {
  if (data && typeof data.korean === 'string' && typeof data.vietnamese === 'string') return data;
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!text) throw new Error('응답 형식을 읽지 못했습니다.');

  try {
    return JSON.parse(text);
  } catch (error) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start > -1 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw error;
  }
}

async function callGemini(prompt, options = {}) {
  const status = getConfigStatus();
  if (!status.loaded) throw new Error('연결 준비가 필요합니다.');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs || REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(status.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
      signal: controller.signal
    });

    let data = null;
    try {
      data = await response.json();
    } catch (error) {
      data = null;
    }

    if (!response.ok) {
      const requestError = new Error('요청 처리에 실패했습니다.');
      requestError.status = response.status;
      requestError.userFriendly = data?.userFriendly === true;
      if (data?.message) requestError.message = data.message;
      throw requestError;
    }

    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('요청 시간이 초과되었습니다.');
      timeoutError.status = 'timeout';
      timeoutError.userFriendly = true;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function requestGeminiWithModelFallback(prompt) {
  return callGemini(prompt, { timeoutMs: REQUEST_TIMEOUT_MS });
}
async function handleGenerate(event) {
  event.preventDefault();
  if (messageRequestInProgress) return;
  messageRequestInProgress = true;

  const input = getNoticeInputs();
  const prompt = buildNoticePrompt(input);

  setLoading(true);
  setStatus('잠시만 기다려주세요.');
  koreanResult.textContent = '잠시만 기다려주세요.';
  vietnameseResult.textContent = '잠시만 기다려주세요.';
  koreanResult.classList.remove('empty');
  vietnameseResult.classList.remove('empty');

  try {
    const data = await requestGeminiWithModelFallback(prompt);
    let parsed;

    try {
      parsed = parseGenerateResult(data);
    } catch (error) {
      showRawResponse('응답 형식을 확인해야 합니다.');
      setStatus('응답 형식을 읽지 못했습니다.', 'warn');
      return;
    }

    if (!parsed.korean || !parsed.vietnamese) {
      showRawResponse('응답에 필요한 항목이 부족합니다.');
      setStatus('응답에 필요한 항목이 부족합니다.', 'warn');
      return;
    }

    renderResult(parsed);
    setStatus('메시지가 작성되었습니다.');
  } catch (error) {
    const errorMessage = error.userFriendly ? error.message : formatConnectionError(error);
    koreanResult.textContent = error.userFriendly ? errorMessage : '연결 준비가 필요합니다.';
    vietnameseResult.textContent = errorMessage;
    koreanResult.classList.remove('empty');
    vietnameseResult.classList.remove('empty');
    setStatus(errorMessage, error.userFriendly ? 'warn' : 'error');
  } finally {
    messageRequestInProgress = false;
    setLoading(false);
  }
}

function copyText(button, text) {
  const original = button.textContent;
  navigator.clipboard.writeText(text).then(() => {
    button.textContent = '복사 완료';
    button.classList.add('done');
  }).catch(() => {
    button.textContent = '복사 실패';
  }).finally(() => {
    setTimeout(() => {
      button.textContent = original;
      button.classList.remove('done');
    }, 1400);
  });
}

if (deadlineDate) deadlineDate.value = todayString();
if (deadlineTime) deadlineTime.value = '18:00';
updateDeadlineVisibility();
if (useDeadlineCheck) useDeadlineCheck.addEventListener('change', updateDeadlineVisibility);
updateTargetCustomVisibility();
if (targetSelect) targetSelect.addEventListener('change', updateTargetCustomVisibility);
form.addEventListener('submit', handleGenerate);

document.querySelectorAll('[data-copy]').forEach((button) => {
  button.addEventListener('click', () => {
    const text = document.querySelector(`#${button.dataset.copy}`).textContent;
    copyText(button, text);
  });
});

window.VNBossPromptBuilder = {
  getNoticeInputs,
  normalizeNoticeInputs,
  buildNoticePrompt,
  callGemini,
  requestGeminiWithModelFallback
};








