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
const newsDraftsWrap = document.querySelector('#newsDraftsWrap');
const newsPublishedWrap = document.querySelector('#newsPublishedWrap');
const refreshNewsButton = document.querySelector('#refreshNews');
const generateNewsButton = document.querySelector('#generateNews');

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

  const rows = members.map((member) => `
    <tr>
      <td>${member.displayName || '-'}</td>
      <td>${member.email || '-'}</td>
      <td>${formatDate(member.firstSeen)}</td>
      <td>${formatDate(member.lastSeen)}</td>
      <td>${member.totalRequests || 0}</td>
      <td><button data-reset-user="${member.userId}">오늘 사용량 초기화</button></td>
    </tr>
  `).join('');

  membersTableWrap.innerHTML = note + `
    <table class="admin-table">
      <thead><tr><th>이름</th><th>이메일</th><th>가입/최초</th><th>최근 접속</th><th>총 요청</th><th></th></tr></thead>
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
    setTimeout(() => {
      button.textContent = original;
      button.disabled = false;
    }, 1200);
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

function renderNewsCard(item, isDraft) {
  const meta = `${escapeHtml(item.sourceName)}${item.pubDate ? ' · ' + escapeHtml(item.pubDate) : ''} · <a href="${escapeHtml(item.link)}" target="_blank" rel="noopener">원문 링크</a>`;
  const point = item.ownerPointKo ? `<p class="news-point">💡 ${escapeHtml(item.ownerPointKo)}</p>` : '';
  const actions = isDraft
    ? `<div class="news-actions"><button class="news-publish" data-news-publish="${item.id}">게시</button><button class="news-danger" data-news-reject="${item.id}">삭제</button></div>`
    : `<div class="news-actions"><button class="news-danger" data-news-remove="${item.id}">게시 취소</button></div>`;
  return `<div class="news-card">
    <h4>${escapeHtml(item.titleKo)}</h4>
    <p class="news-body">${escapeHtml(item.summaryKo)}</p>
    ${point}
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
if (refreshNewsButton) refreshNewsButton.addEventListener('click', loadNews);
if (generateNewsButton) generateNewsButton.addEventListener('click', async () => {
  const original = generateNewsButton.textContent;
  generateNewsButton.disabled = true;
  generateNewsButton.textContent = '생성 중... (최대 1분)';
  try {
    const result = await adminFetch('/api/admin/news-generate', { method: 'POST' });
    generateNewsButton.textContent = `완료: ${result.created || 0}건${result.note ? ' (' + result.note + ')' : ''}`;
    await loadNews();
  } catch (error) {
    generateNewsButton.textContent = '실패: ' + error.message;
  } finally {
    setTimeout(() => {
      generateNewsButton.textContent = original;
      generateNewsButton.disabled = false;
    }, 2500);
  }
});

initFirebase();
