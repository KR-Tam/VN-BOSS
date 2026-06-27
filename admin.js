const ADMIN_SECRET_STORAGE_KEY = 'vnBossAdminSecret';

const adminGate = document.querySelector('#adminGate');
const adminDashboard = document.querySelector('#adminDashboard');
const adminSecretInput = document.querySelector('#adminSecretInput');
const adminLoginButton = document.querySelector('#adminLoginButton');
const adminGateStatus = document.querySelector('#adminGateStatus');
const adminLogoutButton = document.querySelector('#adminLogoutButton');
const membersTableWrap = document.querySelector('#membersTableWrap');
const errorsTableWrap = document.querySelector('#errorsTableWrap');
const refreshMembersButton = document.querySelector('#refreshMembers');
const refreshErrorsButton = document.querySelector('#refreshErrors');

function getApiBase() {
  const config = window.VN_BOSS_CONFIG || {};
  const endpoint = typeof config.API_ENDPOINT === 'string' && config.API_ENDPOINT.trim()
    ? config.API_ENDPOINT.trim()
    : '/api/generate';
  return endpoint.replace(/\/api\/generate$/, '');
}

function getAdminSecret() {
  return localStorage.getItem(ADMIN_SECRET_STORAGE_KEY) || '';
}

function setAdminSecret(secret) {
  localStorage.setItem(ADMIN_SECRET_STORAGE_KEY, secret);
}

function clearAdminSecret() {
  localStorage.removeItem(ADMIN_SECRET_STORAGE_KEY);
}

async function adminFetch(path, options = {}) {
  const response = await fetch(`${getApiBase()}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-VN-Boss-Admin-Secret': getAdminSecret(),
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
  adminGate.style.display = 'none';
  adminDashboard.style.display = 'block';
  loadMembers();
  loadErrors();
}

function showGate(message) {
  adminGate.style.display = 'block';
  adminDashboard.style.display = 'none';
  if (adminGateStatus) adminGateStatus.textContent = message || '';
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
    renderMembers(data.members || []);
  } catch (error) {
    if (error.message === 'UNAUTHORIZED') {
      clearAdminSecret();
      showGate('인증이 만료되었습니다. 다시 입력해주세요.');
      return;
    }
    membersTableWrap.innerHTML = `<p class="admin-empty">불러오기 실패: ${error.message}</p>`;
  }
}

function renderMembers(members) {
  if (!members.length) {
    membersTableWrap.innerHTML = '<p class="admin-empty">아직 기록된 회원이 없습니다. 회원이 메시지 생성을 한 번 이상 시도하면 표시됩니다.</p>';
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

  membersTableWrap.innerHTML = `
    <table class="admin-table">
      <thead><tr><th>이름</th><th>이메일</th><th>최초 접속</th><th>최근 접속</th><th>총 요청</th><th></th></tr></thead>
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
      clearAdminSecret();
      showGate('인증이 만료되었습니다. 다시 입력해주세요.');
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

adminLoginButton.addEventListener('click', async () => {
  const secret = adminSecretInput.value.trim();
  if (!secret) {
    adminGateStatus.textContent = '비밀키를 입력해주세요.';
    return;
  }
  setAdminSecret(secret);
  try {
    await adminFetch('/api/admin/members');
    showDashboard();
  } catch (error) {
    clearAdminSecret();
    adminGateStatus.textContent = error.message === 'UNAUTHORIZED' ? '비밀키가 올바르지 않습니다.' : `연결 실패: ${error.message}`;
  }
});

adminLogoutButton.addEventListener('click', () => {
  clearAdminSecret();
  showGate('');
});

refreshMembersButton.addEventListener('click', loadMembers);
refreshErrorsButton.addEventListener('click', loadErrors);

if (getAdminSecret()) {
  adminFetch('/api/admin/members').then(() => showDashboard()).catch(() => {
    clearAdminSecret();
    showGate('');
  });
}
