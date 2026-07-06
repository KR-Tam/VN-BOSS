const ADMIN_EMAILS = ['sirisiri1148@gmail.com'];

const adminGate = document.querySelector('#adminGate');
const adminDashboard = document.querySelector('#adminDashboard');
const adminLoginButton = document.querySelector('#adminLoginButton');
const adminGateStatus = document.querySelector('#adminGateStatus');
const adminLogoutButton = document.querySelector('#adminLogoutButton');
const membersTableWrap = document.querySelector('#membersTableWrap');
const errorsTableWrap = document.querySelector('#errorsTableWrap');
const refreshMembersButton = document.querySelector('#refreshMembers');
const refreshErrorsButton = document.querySelector('#refreshErrors');
const usageWrap = document.querySelector('#usageWrap');
const refreshUsageButton = document.querySelector('#refreshUsage');
const balanceInput = document.querySelector('#balanceInput');
const saveBalanceButton = document.querySelector('#saveBalance');
const newsDraftsWrap = document.querySelector('#newsDraftsWrap');
const newsPublishedWrap = document.querySelector('#newsPublishedWrap');
const newsCandidatesWrap = document.querySelector('#newsCandidatesWrap');
const refreshNewsButton = document.querySelector('#refreshNews');
const loadCandidatesButton = document.querySelector('#loadCandidates');
const generateSelectedButton = document.querySelector('#generateSelected');

let firebaseAuth = null;
let firebaseProvider = null;

function getApiBase() {
  const config = window.VN_BOSS_CONFIG || {};
  const endpoint = typeof config.API_ENDPOINT === 'string' && config.API_ENDPOINT.trim()
    ? config.API_ENDPOINT.trim()
    : '/api/generate';
  return endpoint.replace(/\/api\/generate$/, '');
}

function initFirebase() {
  const config = window.VN_BOSS_CONFIG || {};
  if (!window.firebase || !config.FIREBASE_CONFIG) {
    if (adminGateStatus) adminGateStatus.textContent = '로그인 설정을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.';
    return;
  }
  const existingApps = firebase.apps || [];
  if (!existingApps.length) firebase.initializeApp(config.FIREBASE_CONFIG);
  firebaseAuth = firebase.auth();
  firebaseProvider = new firebase.auth.GoogleAuthProvider();
  firebaseProvider.setCustomParameters({ prompt: 'select_account' });

  firebaseAuth.onAuthStateChanged((user) => {
    if (user && ADMIN_EMAILS.includes((user.email || '').toLowerCase())) {
      showDashboard();
    } else if (user) {
      showGate('관리자 권한이 없는 계정입니다.');
    } else {
      showGate();
    }
  });
}

async function getIdToken() {
  if (!firebaseAuth || !firebaseAuth.currentUser) return '';
  try {
    return await firebaseAuth.currentUser.getIdToken();
  } catch (error) {
    return '';
  }
}

async function adminFetch(path, options = {}) {
  const token = await getIdToken();
  const response = await fetch(`${getApiBase()}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...(options.headers || {})
    }
  });

  if (response.status === 401) {
    throw new Error('UNAUTHORIZED');
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || '요청에 실패했습니다.');
  }
  return response.json();
}

function showDashboard() {
  if (adminGateStatus) adminGateStatus.textContent = '';
  adminGate.style.display = 'none';
  adminDashboard.style.display = 'block';
  loadMembers();
  loadErrors();
  loadNews();
  loadUsage();
}

function fmtUsd(value) {
  const n = Number(value) || 0;
  return '$' + (n < 1 ? n.toFixed(4) : n.toFixed(2));
}

async function loadUsage() {
  if (!usageWrap) return;
  usageWrap.innerHTML = '<p class="admin-empty">불러오는 중...</p>';
  try {
    const data = await adminFetch('/api/admin/usage');
    renderUsage(data);
  } catch (error) {
    if (error.message === 'UNAUTHORIZED') { showGate('관리자 인증이 만료되었습니다. 다시 로그인해주세요.'); return; }
    usageWrap.innerHTML = `<p class="admin-empty">불러오기 실패: ${error.message}</p>`;
  }
}

function renderUsage(data) {
  const total = data.total || { cost: 0 };
  const month = data.thisMonth || { cost: 0, message: 0, news: 0 };
  const balance = data.balance;
  let balanceRow = '<tr><td>예상 남은 금액</td><td>잔액을 입력하면 표시됩니다.</td></tr>';
  if (balance) {
    const remaining = Number(balance.remaining) || 0;
    const color = remaining <= 0 ? '#b94040' : (remaining < 2 ? '#b9791a' : '#087f6f');
    balanceRow = `<tr><td>예상 남은 금액</td><td style="font-weight:700;color:${color};">${fmtUsd(remaining)} <span style="color:#98a2b3;font-weight:400;">(입력 잔액 ${fmtUsd(balance.amount)} − 이후 사용 ${fmtUsd(balance.spentSince)})</span></td></tr>`;
    if (balanceInput && !balanceInput.value) balanceInput.value = balance.amount;
  }
  usageWrap.innerHTML = `
    <table class="admin-table">
      <tbody>
        <tr><td>이번 달 예상 사용액</td><td style="font-weight:700;">${fmtUsd(month.cost)} <span style="color:#98a2b3;font-weight:400;">(메시지 ${fmtUsd(month.message)} · 뉴스 ${fmtUsd(month.news)})</span></td></tr>
        <tr><td>누적 예상 사용액</td><td>${fmtUsd(total.cost)}</td></tr>
        ${balanceRow}
      </tbody>
    </table>`;
}

async function saveBalance() {
  const amount = balanceInput ? Number(balanceInput.value) : NaN;
  if (isNaN(amount) || amount < 0) { alert('잔액을 숫자로 입력하세요.'); return; }
  const original = saveBalanceButton.textContent;
  saveBalanceButton.disabled = true;
  saveBalanceButton.textContent = '저장 중...';
  try {
    await adminFetch('/api/admin/usage-balance', { method: 'POST', body: JSON.stringify({ amount }) });
    await loadUsage();
    saveBalanceButton.textContent = '저장됨';
  } catch (error) {
    saveBalanceButton.textContent = '실패';
  } finally {
    setTimeout(() => { saveBalanceButton.textContent = original; saveBalanceButton.disabled = false; }, 1500);
  }
}

function showGate(message) {
  adminGate.style.display = 'block';
  adminDashboard.style.display = 'none';
  if (typeof message === 'string' && adminGateStatus) adminGateStatus.textContent = message;
}

function formatDate(value) {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (error) {
    return value;
  }
}

async function loadMembers() {
  membersTableWrap.innerHTML = '<p class="admin-empty">불러오는 중...</p>';
  try {
    const data = await adminFetch('/api/admin/members');
    renderMembers(data.members || [], data.integrated === true);
  } catch (error) {
    if (error.message === 'UNAUTHORIZED') {
      showGate('관리자 인증이 만료되었습니다. 다시 로그인해주세요.');
      return;
    }
    membersTableWrap.innerHTML = `<p class="admin-empty">불러오기 실패: ${error.message}</p>`;
  }
}

function renderMembers(members, integrated) {
  const note = integrated
    ? '<p class="admin-meta" style="margin:0 0 10px;color:#087f6f;">Firebase 전체 가입자 기준으로 표시 중입니다. (가입만 하고 미방문한 회원도 포함)</p>'
    : '<p class="admin-meta" style="margin:0 0 10px;">서버 기록(KV) 기준입니다. Firebase 전체 가입자 표시는 서비스 계정 설정이 필요합니다.</p>';

  if (!members.length) {
    membersTableWrap.innerHTML = note + '<p class="admin-empty">아직 표시할 회원이 없습니다.</p>';
    return;
  }

  const rows = members.map((member) => {
    const limit = member.dailyLimit || 10;
    const today = member.todayUsage || 0;
    return `
    <tr>
      <td>${member.displayName || '-'}</td>
      <td>${member.email || '-'}</td>
      <td>${formatDate(member.firstSeen)}</td>
      <td>${formatDate(member.lastSeen)}</td>
      <td>${today} / ${limit}</td>
      <td>${member.totalRequests || 0}</td>
      <td><button data-reset-user="${member.userId}">금일 초기화</button></td>
    </tr>
  `;
  }).join('');

  membersTableWrap.innerHTML = note + `
    <table class="admin-table">
      <thead><tr><th>이름</th><th>이메일</th><th>가입/최초</th><th>최근 접속</th><th>금일 요청</th><th>총 요청</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  membersTableWrap.querySelectorAll('[data-reset-user]').forEach((button) => {
    button.addEventListener('click', () => resetQuota(button.dataset.resetUser, button));
  });
}

async function resetQuota(userId, button) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = '초기화 중...';
  try {
    await adminFetch('/api/admin/reset-quota', {
      method: 'POST',
      body: JSON.stringify({ userId, memberType: 'free' })
    });
    button.textContent = '완료';
    setTimeout(() => { loadMembers(); }, 600);
  } catch (error) {
    button.textContent = '실패';
    button.disabled = false;
  }
}

async function loadErrors() {
  errorsTableWrap.innerHTML = '<p class="admin-empty">불러오는 중...</p>';
  try {
    const data = await adminFetch('/api/admin/errors');
    renderErrors(data.errors || []);
  } catch (error) {
    if (error.message === 'UNAUTHORIZED') {
      showGate('관리자 인증이 만료되었습니다. 다시 로그인해주세요.');
      return;
    }
    errorsTableWrap.innerHTML = `<p class="admin-empty">불러오기 실패: ${error.message}</p>`;
  }
}

function renderErrors(errors) {
  if (!errors.length) {
    errorsTableWrap.innerHTML = '<p class="admin-empty">최근 오류가 없습니다.</p>';
    return;
  }

  const rows = errors.map((entry) => `
    <tr>
      <td>${formatDate(entry.at)}</td>
      <td>${entry.code || '-'}</td>
      <td>${entry.status || '-'}</td>
      <td>${entry.memberType || '-'}</td>
      <td>${entry.message || '-'}</td>
    </tr>
  `).join('');

  errorsTableWrap.innerHTML = `
    <table class="admin-table">
      <thead><tr><th>시각</th><th>코드</th><th>상태</th><th>회원유형</th><th>메시지</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function loadNews() {
  if (!newsDraftsWrap || !newsPublishedWrap) return;
  newsDraftsWrap.innerHTML = '<p class="admin-empty">불러오는 중...</p>';
  newsPublishedWrap.innerHTML = '';
  try {
    const data = await adminFetch('/api/admin/news-drafts');
    renderNews(data.drafts || [], data.published || []);
  } catch (error) {
    if (error.message === 'UNAUTHORIZED') {
      showGate('관리자 인증이 만료되었습니다. 다시 로그인해주세요.');
      return;
    }
    newsDraftsWrap.innerHTML = `<p class="admin-empty">불러오기 실패: ${error.message}</p>`;
  }
}

function formatNewsDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (isNaN(date.getTime())) return '';
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function renderNewsCard(item, isDraft) {
  const dateStr = formatNewsDate(item.pubDate || item.publishedAt);
  const meta = `${escapeHtml(item.sourceName)}${dateStr ? ' · ' + dateStr : ''} · <a href="${escapeHtml(item.link)}" target="_blank" rel="noopener">원문 링크</a>`;
  const policy = item.policyChangeKo ? `<p class="news-body" style="background:#fff7e8;padding:8px 10px;border-radius:6px;"><strong>📋 정책 전/후:</strong> ${escapeHtml(item.policyChangeKo)}</p>` : '';
  const official = item.officialTextKo ? `<p class="news-body" style="background:#f3f4f6;padding:8px 10px;border-radius:6px;"><strong>📜 법령 원문(비공식 번역):</strong> ${escapeHtml(item.officialTextKo)}</p>` : '';
  const point = item.ownerPointKo ? `<p class="news-point">💡 ${escapeHtml(item.ownerPointKo)}</p>` : '';
  const discussion = item.discussionKo ? `<p class="news-point" style="background:#eef6f3;">🗣️ 논점: ${escapeHtml(item.discussionKo)}</p>` : '';
  const actions = isDraft
    ? `<div class="news-actions"><button class="news-publish" data-news-publish="${item.id}">게시</button><button class="news-danger" data-news-reject="${item.id}">삭제</button></div>`
    : `<div class="news-actions"><button class="news-danger" data-news-remove="${item.id}">게시 취소</button></div>`;
  return `<div class="news-card">
    <h4>${escapeHtml(item.titleKo)}</h4>
    <p class="news-body">${escapeHtml(item.summaryKo)}</p>
    ${policy}
    ${official}
    ${point}
    ${discussion}
    <p class="news-meta">${meta}</p>
    ${actions}
  </div>`;
}

function renderNews(drafts, published) {
  if (!drafts.length) {
    newsDraftsWrap.innerHTML = '<p class="admin-empty">승인 대기 중인 초안이 없습니다. “지금 초안 생성”으로 테스트할 수 있습니다.</p>';
  } else {
    newsDraftsWrap.innerHTML = drafts.map((item) => renderNewsCard(item, true)).join('');
  }
  if (!published.length) {
    newsPublishedWrap.innerHTML = '<p class="admin-empty">게시된 뉴스가 없습니다.</p>';
  } else {
    newsPublishedWrap.innerHTML = published.map((item) => renderNewsCard(item, false)).join('');
  }

  newsDraftsWrap.querySelectorAll('[data-news-publish]').forEach((button) => {
    button.addEventListener('click', () => newsAction('/api/admin/news-publish', { id: button.dataset.newsPublish }, button));
  });
  newsDraftsWrap.querySelectorAll('[data-news-reject]').forEach((button) => {
    button.addEventListener('click', () => newsAction('/api/admin/news-reject', { id: button.dataset.newsReject }, button));
  });
  newsPublishedWrap.querySelectorAll('[data-news-remove]').forEach((button) => {
    button.addEventListener('click', () => newsAction('/api/admin/news-reject', { id: button.dataset.newsRemove, target: 'published' }, button));
  });
}

async function newsAction(path, body, button) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = '처리 중...';
  try {
    await adminFetch(path, { method: 'POST', body: JSON.stringify(body) });
    await loadNews();
  } catch (error) {
    button.textContent = '실패';
    button.disabled = false;
    setTimeout(() => { button.textContent = original; }, 1200);
  }
}

async function loadCandidates() {
  if (!newsCandidatesWrap) return;
  newsCandidatesWrap.innerHTML = '<p class="admin-empty">후보를 불러오는 중... (RSS 조회 + AI 관련성 정렬, 최대 30초)</p>';
  try {
    const data = await adminFetch('/api/admin/news-candidates', { method: 'POST' });
    renderCandidates(data.candidates || [], data.note);
  } catch (error) {
    if (error.message === 'UNAUTHORIZED') { showGate('관리자 인증이 만료되었습니다. 다시 로그인해주세요.'); return; }
    newsCandidatesWrap.innerHTML = `<p class="admin-empty">불러오기 실패: ${error.message}</p>`;
  }
}

function renderCandidates(candidates, note) {
  if (!candidates.length) {
    newsCandidatesWrap.innerHTML = `<p class="admin-empty">${note || '표시할 후보가 없습니다.'}</p>`;
    return;
  }
  const items = candidates.map((c) => {
    const date = formatNewsDate(c.pubDate);
    const reason = c.reasonKo ? `<span class="cand-reason">🤖 ${escapeHtml(c.reasonKo)}</span>` : '';
    return `<label class="cand-item">
      <input type="checkbox" data-cand-id="${escapeHtml(c.id)}">
      <span>
        <strong>${escapeHtml(c.title)}</strong>
        <span class="cand-desc">${escapeHtml(c.description)}</span>
        <span class="cand-meta">${escapeHtml(c.sourceName)}${date ? ' · ' + date : ''} · <a href="${escapeHtml(c.link)}" target="_blank" rel="noopener">원문</a></span>
        ${reason}
      </span>
    </label>`;
  }).join('');
  newsCandidatesWrap.innerHTML = `<p class="admin-meta" style="margin:6px 0;">체크한 뒤 “② 선택한 기사 생성”을 누르면 선택한 기사만 요약이 생성됩니다(비용 발생 지점).</p>${items}`;
}

async function generateSelected() {
  if (!newsCandidatesWrap) return;
  const ids = [].map.call(newsCandidatesWrap.querySelectorAll('input[data-cand-id]:checked'), (el) => el.dataset.candId);
  if (!ids.length) {
    alert('생성할 기사를 하나 이상 선택하세요.');
    return;
  }
  const original = generateSelectedButton.textContent;
  generateSelectedButton.disabled = true;
  generateSelectedButton.textContent = `생성 중... (${ids.length}건, 최대 1~2분)`;
  try {
    const result = await adminFetch('/api/admin/news-generate-selected', { method: 'POST', body: JSON.stringify({ ids }) });
    generateSelectedButton.textContent = `완료: ${result.created || 0}건`;
    newsCandidatesWrap.innerHTML = '';
    await loadNews();
  } catch (error) {
    generateSelectedButton.textContent = '실패: ' + error.message;
  } finally {
    setTimeout(() => {
      generateSelectedButton.textContent = original;
      generateSelectedButton.disabled = false;
    }, 2500);
  }
}

adminLoginButton.addEventListener('click', async () => {
  if (!firebaseAuth || !firebaseProvider) {
    adminGateStatus.textContent = '로그인 설정을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.';
    return;
  }
  adminGateStatus.textContent = 'Google 로그인 창이 열립니다.';
  try {
    const result = await firebaseAuth.signInWithPopup(firebaseProvider);
    const email = ((result.user && result.user.email) || '').toLowerCase();
    if (!ADMIN_EMAILS.includes(email)) {
      adminGateStatus.textContent = '관리자 권한이 없는 계정입니다.';
      await firebaseAuth.signOut();
      return;
    }
    // onAuthStateChanged will show the dashboard.
  } catch (error) {
    const canceled = error && (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request');
    adminGateStatus.textContent = canceled ? '로그인이 취소되었습니다.' : '로그인에 실패했습니다. 다시 시도해주세요.';
  }
});

adminLogoutButton.addEventListener('click', async () => {
  if (firebaseAuth) {
    try { await firebaseAuth.signOut(); } catch (error) {}
  }
  showGate('');
});

refreshMembersButton.addEventListener('click', loadMembers);
refreshErrorsButton.addEventListener('click', loadErrors);
if (refreshUsageButton) refreshUsageButton.addEventListener('click', loadUsage);
if (saveBalanceButton) saveBalanceButton.addEventListener('click', saveBalance);
if (refreshNewsButton) refreshNewsButton.addEventListener('click', loadNews);
if (loadCandidatesButton) loadCandidatesButton.addEventListener('click', async () => {
  const original = loadCandidatesButton.textContent;
  loadCandidatesButton.disabled = true;
  loadCandidatesButton.textContent = '불러오는 중...';
  try {
    await loadCandidates();
  } finally {
    loadCandidatesButton.textContent = original;
    loadCandidatesButton.disabled = false;
  }
});
if (generateSelectedButton) generateSelectedButton.addEventListener('click', generateSelected);

initFirebase();
