const form = document.querySelector('#noticeForm');
const koreanResult = document.querySelector('#koreanResult');
const vietnameseResult = document.querySelector('#vietnameseResult');
const statusBox = document.querySelector('#statusBox');
const generateButton = document.querySelector('#generateButton');
const usageBox = document.querySelector('#usageBox');
const memberPill = document.querySelector('#memberPill');
const authButton = document.querySelector('#authButton');
const loginModal = document.querySelector('#loginModal');
const modalClose = document.querySelector('#modalClose');
const modalLoginButton = document.querySelector('#modalLoginButton');
const copyLinkButton = document.querySelector('#copyLinkButton');
const historyList = document.querySelector('#historyList');
const adminLink = document.querySelector('#adminLink');
const ADMIN_EMAILS = ['sirisiri1148@gmail.com'];
const profileModal = document.querySelector('#profileModal');
const profileModalClose = document.querySelector('#profileModalClose');
const profileEmail = document.querySelector('#profileEmail');
const profileJoinedAt = document.querySelector('#profileJoinedAt');
const profileUsage = document.querySelector('#profileUsage');
const profileNicknameInput = document.querySelector('#profileNicknameInput');
const profileSaveButton = document.querySelector('#profileSaveButton');
const profileLogoutButton = document.querySelector('#profileLogoutButton');
const editProfileButton = document.querySelector('#editProfileButton');
const logoutButton = document.querySelector('#logoutButton');
const historyManageButton = document.querySelector('#historyManageButton');
const historyModal = document.querySelector('#historyModal');
const historyModalClose = document.querySelector('#historyModalClose');
const historyModalList = document.querySelector('#historyModalList');
const installFab = document.querySelector('#installFab');
const installFabClose = document.querySelector('#installFabClose');
const installModal = document.querySelector('#installModal');
const installModalClose = document.querySelector('#installModalClose');
const installModalDesc = document.querySelector('#installModalDesc');
const installSteps = document.querySelector('#installSteps');
const installConfirmButton = document.querySelector('#installConfirmButton');
let deferredInstallPrompt = null;
const INSTALL_DISMISS_KEY = 'vnBossInstallDismissed';
const newsGrid = document.querySelector('#newsGrid');
const loginModalTitle = document.querySelector('#loginModalTitle');
const loginModalCopy = loginModal ? loginModal.querySelector('p:not(.eyebrow)') : null;
let firebaseAuth = null;
let firebaseProvider = null;
let authReady = false;
const targetSelect = document.querySelector('#target');
const targetCustomWrap = document.querySelector('#targetCustomWrap');
const targetCustomInput = document.querySelector('#targetCustom');
const useDeadlineCheck = document.querySelector('#useDeadline');
const deadlineFields = document.querySelector('#deadlineFields');
const deadlineDate = document.querySelector('#deadlineDate');
const deadlineTime = document.querySelector('#deadlineTime');
let messageRequestInProgress = false;

const MEMBERSHIP_LIMITS = {
  guest: 0,
  free: 10
};
const MEMBER_STORAGE_KEY = 'vnBossMemberState';
const USAGE_STORAGE_KEY = 'vnBossDailyUsage';
const HISTORY_STORAGE_KEY = 'vnBossHistory';
const TEMPLATE_STORAGE_KEY = 'vnBossTemplates';

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

function getMemberState() {
  try {
    const saved = JSON.parse(localStorage.getItem(MEMBER_STORAGE_KEY) || 'null');
    if (saved && saved.provider === 'google-demo') {
      localStorage.removeItem(MEMBER_STORAGE_KEY);
    } else if (saved && saved.type === 'free' && saved.userId && saved.provider === 'firebase-google') {
      return saved;
    }
  } catch (error) {}
  return { type: 'guest', userId: getGuestId(), displayName: '비회원' };
}

function getGuestId() {
  const key = 'vnBossGuestId';
  let id = localStorage.getItem(key);
  if (!id) {
    id = `guest-${crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;
    localStorage.setItem(key, id);
  }
  return id;
}

function getDailyUsage() {
  const today = todayString();
  try {
    const usage = JSON.parse(localStorage.getItem(USAGE_STORAGE_KEY) || 'null');
    if (usage && usage.date === today) return usage;
  } catch (error) {}
  return { date: today, guest: 0, free: 0 };
}

function saveDailyUsage(usage) {
  localStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify(usage));
}

function getCurrentLimit() {
  return MEMBERSHIP_LIMITS[getMemberState().type] || MEMBERSHIP_LIMITS.guest;
}

function getCurrentUsageCount() {
  const member = getMemberState();
  const usage = getDailyUsage();
  return usage[member.type] || 0;
}

function canUseAiPreview() {
  return getCurrentUsageCount() < getCurrentLimit();
}

function recordAiUsage() {
  const member = getMemberState();
  const usage = getDailyUsage();
  usage[member.type] = (usage[member.type] || 0) + 1;
  saveDailyUsage(usage);
  updateMemberUI();
}

function isMember() {
  return getMemberState().type === 'free';
}

function initFirebaseAuth() {
  const config = window.VN_BOSS_CONFIG || {};
  if (!window.firebase || !config.FIREBASE_CONFIG) {
    authReady = false;
    return;
  }

  try {
    const existingApps = firebase.apps || [];
    if (!existingApps.length) firebase.initializeApp(config.FIREBASE_CONFIG);
    firebaseAuth = firebase.auth();
    firebaseProvider = new firebase.auth.GoogleAuthProvider();
    firebaseProvider.setCustomParameters({ prompt: 'select_account' });
    authReady = true;

    firebaseAuth.onAuthStateChanged((user) => {
      if (!user) {
        updateMemberUI();
        return;
      }
      saveFirebaseMember(user);
      updateMemberUI();
      closeLoginModal();
      registerMemberOnServer();
    });


  } catch (error) {
    authReady = false;
    console.error('[VN Boss] Firebase init failed:', error);
  }
}

function saveFirebaseMember(user) {
  const existing = getMemberState();
  const customName = existing.userId === user.uid && existing.customDisplayName ? existing.customDisplayName : '';
  const member = {
    type: 'free',
    userId: user.uid,
    displayName: customName || user.displayName || user.email || '무료 회원',
    customDisplayName: customName,
    googleDisplayName: user.displayName || '',
    email: user.email || '',
    provider: 'firebase-google',
    joinedAt: existing.userId === user.uid && existing.joinedAt ? existing.joinedAt : new Date().toISOString()
  };
  localStorage.setItem(MEMBER_STORAGE_KEY, JSON.stringify(member));
}

async function registerMemberOnServer() {
  const member = getMemberState();
  if (member.type !== 'free' || !member.userId) return;
  try {
    const status = getConfigStatus();
    const base = status.endpoint.replace(/\/api\/generate$/, '');
    await fetch(`${base}/api/member-register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-VN-Boss-Member-State': member.type,
        'X-VN-Boss-User-Id': member.userId,
        'X-VN-Boss-Email': member.email || '',
        'X-VN-Boss-Display-Name': member.displayName || ''
      }
    });
  } catch (error) {
    console.error('[VN Boss] Member register failed:', error);
  }
}
function isMobileDevice() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
}

function isLikelyInAppBrowser() {
  const ua = navigator.userAgent || '';
  return /FBAN|FBAV|Instagram|Line|KAKAOTALK|NAVER|Zalo|MicroMessenger|; wv\)|\bwv\b|GSA/i.test(ua);
}

function showSecureBrowserLoginGuide() {
  openLoginModal(
    '외부 브라우저에서 로그인해주세요',
    '현재 앱 내부 브라우저에서는 Google 로그인이 차단됩니다. Chrome, Safari 같은 일반 브라우저에서 VN Boss를 열어 로그인해주세요.'
  );
  showCopyLinkButton();
  setStatus('현재 브라우저에서는 Google 로그인이 차단됩니다. 주소를 복사해 Chrome 또는 Safari에서 열어주세요.', 'warn');
}

async function signInWithGoogle() {
  if (!authReady || !firebaseAuth || !firebaseProvider) {
    openLoginModal(
      'Google 로그인 설정을 확인해주세요',
      'Firebase 로그인을 불러오지 못했습니다. 잠시 후 다시 시도하거나 관리자에게 문의해주세요.'
    );
    setStatus('Google 로그인 설정을 확인해주세요.', 'warn');
    return;
  }

  if (isLikelyInAppBrowser()) {
    showSecureBrowserLoginGuide();
    return;
  }

  try {
    setStatus('Google 로그인 창이 열립니다.');
    if (modalLoginButton) modalLoginButton.textContent = '이동 중...';

    const result = await firebaseAuth.signInWithPopup(firebaseProvider);
    if (result.user) saveFirebaseMember(result.user);
    updateMemberUI();
    closeLoginModal();
    setStatus('Google 로그인 완료. 무료 회원 기능을 사용할 수 있습니다.');
  } catch (error) {
    console.error('[VN Boss] Google sign-in failed:', error);
    if (modalLoginButton) modalLoginButton.textContent = 'Google로 무료 시작';
    const canceled = error && (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request');
    const blocked = error && (error.code === 'auth/operation-not-supported-in-this-environment' || error.code === 'auth/web-storage-unsupported' || error.code === 'auth/popup-blocked');
    if (blocked) {
      showSecureBrowserLoginGuide();
      return;
    }
    setStatus(canceled ? 'Google 로그인이 취소되었습니다.' : 'Google 로그인에 실패했습니다. Firebase 승인 도메인을 확인해주세요.', 'warn');
  }
}

function signOutMember() {
  if (firebaseAuth) {
    firebaseAuth.signOut().catch((error) => console.error('[VN Boss] Sign-out failed:', error));
  }
  localStorage.removeItem(MEMBER_STORAGE_KEY);
  closeProfileModal();
  updateMemberUI();
  setStatus('로그아웃되었습니다.');
}

function saveCustomDisplayName(name) {
  const member = getMemberState();
  if (member.type !== 'free') return;
  member.customDisplayName = name.trim();
  member.displayName = member.customDisplayName || member.googleDisplayName || member.email || '무료 회원';
  localStorage.setItem(MEMBER_STORAGE_KEY, JSON.stringify(member));
  updateMemberUI();
}
function startGoogleSignup() {
  const config = window.VN_BOSS_CONFIG || {};
  if (config.GOOGLE_AUTH_URL) {
    window.location.href = config.GOOGLE_AUTH_URL;
    return;
  }
  signInWithGoogle();
}

function requireMember(reason) {
  if (isMember()) return true;
  openLoginModal(reason);
  return false;
}

function openLoginModal(reason, detail) {
  if (!loginModal) return;
  loginModal.classList.add('show');
  loginModal.setAttribute('aria-hidden', 'false');
  if (loginModalTitle && reason) loginModalTitle.textContent = reason;
  if (loginModalCopy) {
    loginModalCopy.textContent = detail || 'Google로 시작하면 복사, Zalo 전송, 템플릿 저장, 최근 기록을 바로 사용할 수 있습니다.';
  }
  if (copyLinkButton) copyLinkButton.style.display = 'none';
}

function closeLoginModal() {
  if (!loginModal) return;
  loginModal.classList.remove('show');
  loginModal.setAttribute('aria-hidden', 'true');
  if (loginModalTitle) loginModalTitle.textContent = '결과 활용은 로그인 후 가능합니다';
  if (loginModalCopy) loginModalCopy.textContent = 'Google로 시작하면 복사, Zalo 전송, 템플릿 저장, 최근 기록을 바로 사용할 수 있습니다.';
  if (copyLinkButton) {
    copyLinkButton.style.display = 'none';
    copyLinkButton.textContent = '주소 복사하기';
  }
}

function showCopyLinkButton() {
  if (!copyLinkButton) return;
  copyLinkButton.style.display = 'block';
}

function formatJoinedAt(isoString) {
  if (!isoString) return '-';
  return new Date(isoString).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}

async function openProfileModal() {
  if (!profileModal || !isMember()) return;
  const member = getMemberState();
  if (profileEmail) profileEmail.textContent = member.email || '-';
  if (profileJoinedAt) profileJoinedAt.textContent = formatJoinedAt(member.joinedAt);
  if (profileUsage) profileUsage.textContent = `${getCurrentUsageCount()}/${getCurrentLimit()}회`;
  if (profileNicknameInput) profileNicknameInput.value = member.customDisplayName || '';
  profileModal.classList.add('show');
  profileModal.setAttribute('aria-hidden', 'false');

  try {
    const status = getConfigStatus();
    const base = status.endpoint.replace(/\/api\/generate$/, '');
    const response = await fetch(`${base}/api/member-info`, {
      headers: {
        'X-VN-Boss-Member-State': member.type,
        'X-VN-Boss-User-Id': member.userId
      }
    });
    const data = await response.json();
    if (data.firstSeen && profileJoinedAt) {
      profileJoinedAt.textContent = formatJoinedAt(data.firstSeen);
    }
  } catch (error) {
    console.error('[VN Boss] Failed to load member info:', error);
  }
}

function closeProfileModal() {
  if (!profileModal) return;
  profileModal.classList.remove('show');
  profileModal.setAttribute('aria-hidden', 'true');
}

function updateMemberUI() {
  const member = getMemberState();
  const used = getCurrentUsageCount();
  const limit = getCurrentLimit();
  const isFreeMember = member.type === 'free';
  if (memberPill) memberPill.textContent = isFreeMember ? '무료 회원 · ' + (member.displayName || 'Google') : '비회원';
  if (authButton) {
    authButton.textContent = 'Google로 시작';
    authButton.disabled = false;
    authButton.style.display = isFreeMember ? 'none' : '';
  }
  if (editProfileButton) editProfileButton.style.display = isFreeMember ? '' : 'none';
  if (historyManageButton) historyManageButton.style.display = isFreeMember ? '' : 'none';
  if (logoutButton) logoutButton.style.display = isFreeMember ? '' : 'none';
  if (usageBox) {
    usageBox.textContent = member.type === 'free'
      ? `메시지 작성 사용량: ${used}/${limit}회`
      : `비회원은 이용할 수 없습니다. 간단한 구글 로그인 후 이용 바랍니다.`;
  }
  if (adminLink) {
    const isAdmin = member.type === 'free' && ADMIN_EMAILS.includes((member.email || '').toLowerCase());
    adminLink.style.display = isAdmin ? 'inline-block' : 'none';
  }
  renderHistory();
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
      headers: {
        'Content-Type': 'application/json',
        'X-VN-Boss-Member-State': getMemberState().type,
        'X-VN-Boss-User-Id': getMemberState().userId,
        'X-VN-Boss-Email': getMemberState().email || '',
        'X-VN-Boss-Display-Name': getMemberState().displayName || ''
      },
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

  if (!canUseAiPreview()) {
    const member = getMemberState();
    if (member.type === 'guest') {
      openLoginModal('메시지 작성은 로그인 후 가능합니다');
      setStatus('서비스 보호를 위해 비회원 메시지 작성은 제공하지 않습니다. 무료 회원은 하루 10회까지 사용할 수 있습니다.', 'warn');
    } else {
      setStatus('오늘의 무료 회원 메시지 작성 사용량을 모두 사용했습니다. 내일 다시 이용해주세요.', 'warn');
    }
    messageRequestInProgress = false;
    return;
  }

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
    recordAiUsage();
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

function getResultText(sourceId) {
  const element = document.querySelector(`#${sourceId}`);
  if (!element || element.classList.contains('empty')) return '';
  return element.textContent.trim();
}

function getSavedList(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value : [];
  } catch (error) {
    return [];
  }
}

function saveListItem(key, item, maxItems = 8) {
  const list = getSavedList(key);
  list.unshift(item);
  localStorage.setItem(key, JSON.stringify(list.slice(0, maxItems)));
}

function saveCurrentResult() {
  if (!requireMember('최근 생성 기록 저장은 로그인 후 가능합니다')) return;
  const korean = getResultText('koreanResult');
  const vietnamese = getResultText('vietnameseResult');
  if (!korean || !vietnamese) {
    setStatus('저장할 메시지가 없습니다.', 'warn');
    return;
  }
  saveListItem(HISTORY_STORAGE_KEY, { korean, vietnamese, savedAt: new Date().toISOString() });
  renderHistory();
  setStatus('최근 생성 기록에 저장되었습니다.');
}

function saveTemplate() {
  if (!requireMember('자주 쓰는 지시문 저장은 로그인 후 가능합니다')) return;
  const input = normalizeNoticeInputs(getNoticeInputs());
  saveListItem(TEMPLATE_STORAGE_KEY, { input, savedAt: new Date().toISOString() });
  setStatus('자주 쓰는 템플릿으로 저장되었습니다.');
}

function renderHistoryInto(container) {
  if (!container) return;
  if (!isMember()) {
    container.textContent = '로그인하면 최근 생성 기록을 저장하고 다시 확인할 수 있습니다.';
    return;
  }
  const history = getSavedList(HISTORY_STORAGE_KEY);
  if (!history.length) {
    container.textContent = '아직 저장된 생성 기록이 없습니다.';
    return;
  }
  container.innerHTML = history.map((item) => {
    const date = new Date(item.savedAt).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    return `<button type="button" class="history-item" data-history-id="${item.savedAt}"><strong>${date}</strong><span>${item.vietnamese.slice(0, 80)}</span></button>`;
  }).join('');
}

function renderHistory() {
  renderHistoryInto(historyList);
  renderHistoryInto(historyModalList);
}

function openHistoryModal() {
  if (!historyModal || !isMember()) return;
  renderHistoryInto(historyModalList);
  historyModal.classList.add('show');
  historyModal.setAttribute('aria-hidden', 'false');
}

function closeHistoryModal() {
  if (!historyModal) return;
  historyModal.classList.remove('show');
  historyModal.setAttribute('aria-hidden', 'true');
}

function openZaloShare(sourceId) {
  if (!requireMember('Zalo 전송은 로그인 후 가능합니다')) return;
  const text = getResultText(sourceId);
  if (!text) {
    setStatus('전송할 메시지가 없습니다.', 'warn');
    return;
  }
  window.open(`https://zalo.me/share?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}

function copyText(button, text) {
  if (!requireMember('복사 기능은 로그인 후 가능합니다')) return;
  if (!text) {
    setStatus('복사할 메시지가 없습니다.', 'warn');
    return;
  }
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

function showGuestExample() {
  if (isMember()) return;
  if (targetSelect) targetSelect.value = '홀 직원';
  const noticeTypeSelect = document.querySelector('#noticeType');
  if (noticeTypeSelect) noticeTypeSelect.value = '업무 요청';
  const toneSelect = document.querySelector('#tone');
  if (toneSelect) toneSelect.value = '강하게';
  const taskInput = document.querySelector('#task');
  if (taskInput) taskInput.value = '매장 및 주방 청소를 마치고 사진찍어 보고해주세요.';
  if (useDeadlineCheck) useDeadlineCheck.checked = true;
  updateDeadlineVisibility();

  const deadlineKorean = `${todayString()} 18:00`;
  const [year, month, day] = todayString().split('-');
  const deadlineVietnamese = `${day}/${month}/${year} 18:00`;

  renderResult({
    korean: `제목: 청소 업무 요청\n대상: 홀 직원\n핵심 요청: 매장 및 주방 청소를 마치고 사진찍어 보고해주세요.\n유의사항: 청소가 완료된 후 반드시 사진을 제출해야 합니다.\n마감일: ${deadlineKorean}`,
    vietnamese: `Tiêu đề: Yêu cầu công việc dọn dẹp\nĐối tượng: Nhân viên phục vụ\nNội dung yêu cầu: Vui lòng hoàn thành việc dọn dẹp cửa hàng và bếp, sau đó chụp ảnh gửi lại cho tôi.\nLưu ý: Phải gửi ảnh sau khi hoàn thành việc dọn dẹp.\nThời hạn: ${deadlineVietnamese}`
  });
  setStatus('예시 화면입니다. 로그인하면 실제 메시지를 작성할 수 있습니다.');
}

initFirebaseAuth();
updateMemberUI();
if (deadlineDate) deadlineDate.value = todayString();
if (deadlineTime) deadlineTime.value = '18:00';
updateDeadlineVisibility();
showGuestExample();
if (useDeadlineCheck) useDeadlineCheck.addEventListener('change', updateDeadlineVisibility);
updateTargetCustomVisibility();
if (targetSelect) targetSelect.addEventListener('change', updateTargetCustomVisibility);
form.addEventListener('submit', handleGenerate);

document.querySelectorAll('[data-copy]').forEach((button) => {
  button.addEventListener('click', () => {
    const text = getResultText(button.dataset.copy);
    copyText(button, text);
  });
});

document.querySelectorAll('[data-action]').forEach((button) => {
  button.addEventListener('click', () => {
    if (button.dataset.action === 'zalo') openZaloShare(button.dataset.source);
    if (button.dataset.action === 'save-result') saveCurrentResult();
    if (button.dataset.action === 'save-template') saveTemplate();
  });
});

function handleGoogleLoginClick(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  startGoogleSignup();
}

if (authButton) authButton.addEventListener('click', handleGoogleLoginClick);
if (modalLoginButton) modalLoginButton.addEventListener('click', handleGoogleLoginClick);
if (modalClose) modalClose.addEventListener('click', closeLoginModal);
if (copyLinkButton) copyLinkButton.addEventListener('click', () => {
  navigator.clipboard.writeText(window.location.href).then(() => {
    copyLinkButton.textContent = '복사 완료';
    setTimeout(() => { copyLinkButton.textContent = '주소 복사하기'; }, 1500);
  }).catch(() => {
    copyLinkButton.textContent = '복사 실패';
  });
});
if (loginModal) loginModal.addEventListener('click', (event) => {
  if (event.target === loginModal) closeLoginModal();
});
if (profileModalClose) profileModalClose.addEventListener('click', closeProfileModal);
if (profileModal) profileModal.addEventListener('click', (event) => {
  if (event.target === profileModal) closeProfileModal();
});
if (profileSaveButton) profileSaveButton.addEventListener('click', () => {
  saveCustomDisplayName(profileNicknameInput ? profileNicknameInput.value : '');
  setStatus('표시 이름이 저장되었습니다.');
  closeProfileModal();
});
if (profileLogoutButton) profileLogoutButton.addEventListener('click', signOutMember);
if (editProfileButton) editProfileButton.addEventListener('click', openProfileModal);
if (logoutButton) logoutButton.addEventListener('click', signOutMember);
if (historyManageButton) historyManageButton.addEventListener('click', openHistoryModal);
if (historyModalClose) historyModalClose.addEventListener('click', closeHistoryModal);
if (historyModal) historyModal.addEventListener('click', (event) => {
  if (event.target === historyModal) closeHistoryModal();
});
function handleHistoryItemClick(event) {
  const itemButton = event.target.closest('[data-history-id]');
  if (!itemButton) return;
  const item = getSavedList(HISTORY_STORAGE_KEY).find((entry) => entry.savedAt === itemButton.dataset.historyId);
  if (!item) return;
  renderResult({ korean: item.korean, vietnamese: item.vietnamese });
  setStatus('저장된 기록을 불러왔습니다.');
  closeHistoryModal();
}
if (historyList) historyList.addEventListener('click', handleHistoryItemClick);
if (historyModalList) historyModalList.addEventListener('click', handleHistoryItemClick);

function isStandaloneMode() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
}

function isIOSDevice() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent || '');
}

function installDismissedThisSession() {
  try {
    return sessionStorage.getItem(INSTALL_DISMISS_KEY) === '1';
  } catch (error) {
    return false;
  }
}

function hideInstallFab() {
  if (installFab) installFab.style.display = 'none';
}

function maybeShowInstallFab() {
  if (!installFab) return;
  if (isStandaloneMode() || installDismissedThisSession()) {
    hideInstallFab();
    return;
  }
  const canPrompt = Boolean(deferredInstallPrompt);
  const iosSafari = isIOSDevice() && !isLikelyInAppBrowser();
  installFab.style.display = (canPrompt || iosSafari) ? 'inline-flex' : 'none';
}

function dismissInstallFab() {
  try {
    sessionStorage.setItem(INSTALL_DISMISS_KEY, '1');
  } catch (error) {}
  hideInstallFab();
}

function buildInstallSteps() {
  if (!installSteps || !installConfirmButton || !installModalDesc) return;
  if (deferredInstallPrompt) {
    installModalDesc.textContent = '아래 버튼을 누르면 바탕화면(또는 홈 화면)에 바로가기가 추가됩니다.';
    installSteps.innerHTML = '';
    installConfirmButton.style.display = 'block';
  } else if (isIOSDevice()) {
    installModalDesc.textContent = 'Safari 하단 공유 메뉴로 홈 화면에 추가할 수 있습니다.';
    installSteps.innerHTML = '<li>하단의 <strong>공유</strong> 버튼(네모+위 화살표)을 누르세요.</li>'
      + '<li><strong>홈 화면에 추가</strong>를 선택하세요.</li>'
      + '<li>오른쪽 위 <strong>추가</strong>를 누르면 완료됩니다.</li>';
    installConfirmButton.style.display = 'none';
  } else {
    installModalDesc.textContent = '브라우저 메뉴에서 “설치” 또는 “홈 화면에 추가”를 선택하세요.';
    installSteps.innerHTML = '<li>주소창 오른쪽의 <strong>설치</strong> 아이콘, 또는 메뉴(⋮)를 누르세요.</li>'
      + '<li><strong>앱 설치</strong> 또는 <strong>바로가기 만들기</strong>를 선택하세요.</li>';
    installConfirmButton.style.display = 'none';
  }
}

function openInstallModal() {
  if (!installModal) return;
  buildInstallSteps();
  installModal.classList.add('show');
  installModal.setAttribute('aria-hidden', 'false');
}

function closeInstallModal() {
  if (!installModal) return;
  installModal.classList.remove('show');
  installModal.setAttribute('aria-hidden', 'true');
}

async function triggerNativeInstall() {
  if (!deferredInstallPrompt) {
    openInstallModal();
    return;
  }
  const promptEvent = deferredInstallPrompt;
  deferredInstallPrompt = null;
  try {
    promptEvent.prompt();
    await promptEvent.userChoice;
  } catch (error) {}
  hideInstallFab();
  closeInstallModal();
}

function handleInstallFabClick() {
  if (deferredInstallPrompt) {
    triggerNativeInstall();
  } else {
    openInstallModal();
  }
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  maybeShowInstallFab();
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  hideInstallFab();
  closeInstallModal();
  setStatus('바로가기가 추가되었습니다. 이제 아이콘으로 바로 접속할 수 있습니다.');
});

if (installFab) installFab.addEventListener('click', handleInstallFabClick);
if (installFabClose) installFabClose.addEventListener('click', (event) => {
  event.stopPropagation();
  dismissInstallFab();
});
if (installModalClose) installModalClose.addEventListener('click', closeInstallModal);
if (installModal) installModal.addEventListener('click', (event) => {
  if (event.target === installModal) closeInstallModal();
});
if (installConfirmButton) installConfirmButton.addEventListener('click', triggerNativeInstall);

maybeShowInstallFab();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((error) => console.error('[VN Boss] SW register failed:', error));
  });
}

function escapeHtmlText(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderNewsCards(news) {
  if (!newsGrid) return;
  if (!Array.isArray(news) || !news.length) {
    newsGrid.innerHTML = '<p class="news-empty">아직 게시된 뉴스가 없습니다. 곧 업데이트됩니다.</p>';
    return;
  }
  newsGrid.innerHTML = news.map((item) => {
    const point = item.ownerPointKo
      ? `<p class="news-point">💡 ${escapeHtmlText(item.ownerPointKo)}</p>`
      : '';
    const id = escapeHtmlText(item.id);
    return `<article class="news-card" data-news-id="${id}">
      <h3>${escapeHtmlText(item.titleKo)}</h3>
      <p class="news-summary">${escapeHtmlText(item.summaryKo)}</p>
      ${point}
      <div class="news-meta">
        <span class="news-source">출처: ${escapeHtmlText(item.sourceName)}</span>
        <a class="news-link" href="${escapeHtmlText(item.link)}" target="_blank" rel="noopener noreferrer">원문 보기</a>
      </div>
      <div class="news-comments">
        <button class="news-comment-toggle" type="button" data-comment-toggle="${id}">💬 댓글</button>
        <div class="news-comment-panel" data-comment-panel="${id}" style="display:none;"></div>
      </div>
    </article>`;
  }).join('');
}

async function getMemberIdToken() {
  if (!firebaseAuth || !firebaseAuth.currentUser) return '';
  try {
    return await firebaseAuth.currentUser.getIdToken();
  } catch (error) {
    return '';
  }
}

function commentItemHtml(comment, currentUid, isAdmin) {
  const canDelete = (comment.userId && comment.userId === currentUid) || isAdmin;
  const del = canDelete
    ? `<button class="comment-del" type="button" data-comment-del="${escapeHtmlText(comment.id)}">삭제</button>`
    : '';
  let time = '';
  try {
    time = new Date(comment.createdAt).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (error) {}
  return `<div class="comment-item">
    <div class="comment-head"><strong>${escapeHtmlText(comment.displayName)}</strong><span>${time}</span></div>
    <p class="comment-text">${escapeHtmlText(comment.text)}</p>
    ${del}
  </div>`;
}

function renderCommentsInto(panel, newsId, comments) {
  if (!panel) return;
  const member = getMemberState();
  const isMemberUser = member.type === 'free';
  const isAdmin = isMemberUser && ADMIN_EMAILS.includes((member.email || '').toLowerCase());
  const list = comments.length
    ? comments.map((comment) => commentItemHtml(comment, member.userId, isAdmin)).join('')
    : '<p class="comment-empty">아직 댓글이 없습니다. 첫 댓글을 남겨보세요.</p>';
  const form = isMemberUser
    ? `<div class="comment-form">
        <textarea class="comment-input" data-comment-input="${escapeHtmlText(newsId)}" maxlength="500" placeholder="댓글을 입력하세요 (최대 500자)"></textarea>
        <button class="comment-submit" type="button" data-comment-submit="${escapeHtmlText(newsId)}">등록</button>
      </div>`
    : '<p class="comment-login">댓글은 로그인한 무료 회원만 작성할 수 있습니다.</p>';
  panel.innerHTML = `<div class="comment-list">${list}</div>${form}`;
}

async function loadComments(newsId, panel) {
  if (!panel) return;
  panel.innerHTML = '<p class="comment-empty">불러오는 중...</p>';
  try {
    const status = getConfigStatus();
    const base = status.endpoint.replace(/\/api\/generate$/, '');
    const response = await fetch(`${base}/api/news/comments?newsId=${encodeURIComponent(newsId)}`);
    const data = await response.json();
    renderCommentsInto(panel, newsId, data.comments || []);
  } catch (error) {
    panel.innerHTML = '<p class="comment-empty">댓글을 불러오지 못했습니다.</p>';
  }
}

async function postComment(newsId, text, panel, button) {
  if (!isMember()) {
    openLoginModal('댓글 작성은 로그인 후 가능합니다');
    return;
  }
  const token = await getMemberIdToken();
  if (!token) {
    openLoginModal('댓글 작성은 로그인 후 가능합니다');
    return;
  }
  const original = button.textContent;
  button.disabled = true;
  button.textContent = '등록 중...';
  try {
    const status = getConfigStatus();
    const base = status.endpoint.replace(/\/api\/generate$/, '');
    const response = await fetch(`${base}/api/news/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ newsId, text })
    });
    if (!response.ok) throw new Error('post failed');
    await loadComments(newsId, panel);
  } catch (error) {
    button.disabled = false;
    button.textContent = original;
    setStatus('댓글 등록에 실패했습니다. 잠시 후 다시 시도해주세요.', 'warn');
  }
}

async function deleteComment(newsId, commentId, panel) {
  const token = await getMemberIdToken();
  if (!token) return;
  try {
    const status = getConfigStatus();
    const base = status.endpoint.replace(/\/api\/generate$/, '');
    const response = await fetch(`${base}/api/news/comments/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ newsId, commentId })
    });
    if (!response.ok) throw new Error('delete failed');
    await loadComments(newsId, panel);
  } catch (error) {
    setStatus('댓글 삭제에 실패했습니다.', 'warn');
  }
}

function findCommentPanel(newsId) {
  return newsGrid ? newsGrid.querySelector(`[data-comment-panel="${newsId}"]`) : null;
}

if (newsGrid) {
  newsGrid.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-comment-toggle]');
    if (toggle) {
      const newsId = toggle.dataset.commentToggle;
      const panel = findCommentPanel(newsId);
      if (!panel) return;
      if (panel.style.display === 'none') {
        panel.style.display = 'block';
        loadComments(newsId, panel);
      } else {
        panel.style.display = 'none';
      }
      return;
    }

    const submit = event.target.closest('[data-comment-submit]');
    if (submit) {
      const newsId = submit.dataset.commentSubmit;
      const panel = findCommentPanel(newsId);
      const input = panel ? panel.querySelector(`[data-comment-input="${newsId}"]`) : null;
      const text = input ? input.value.trim() : '';
      if (!text) {
        setStatus('댓글 내용을 입력해주세요.', 'warn');
        return;
      }
      postComment(newsId, text, panel, submit);
      return;
    }

    const del = event.target.closest('[data-comment-del]');
    if (del) {
      const card = del.closest('[data-news-id]');
      const newsId = card ? card.dataset.newsId : '';
      const panel = findCommentPanel(newsId);
      deleteComment(newsId, del.dataset.commentDel, panel);
    }
  });
}

async function loadPublicNews() {
  if (!newsGrid) return;
  try {
    const status = getConfigStatus();
    const base = status.endpoint.replace(/\/api\/generate$/, '');
    const response = await fetch(`${base}/api/news`);
    const data = await response.json();
    renderNewsCards(data.news || []);
  } catch (error) {
    console.error('[VN Boss] Failed to load news:', error);
    newsGrid.innerHTML = '<p class="news-empty">뉴스를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.</p>';
  }
}

loadPublicNews();

window.VNBossPromptBuilder = {
  getNoticeInputs,
  normalizeNoticeInputs,
  buildNoticePrompt,
  callGemini,
  requestGeminiWithModelFallback
};


















