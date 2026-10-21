let currentUser = null;
let currentPage = 'dashboard';
let availableProviders = [];
let modelConfigs = [];
let conversations = [];
let chatProjects = [];
let selectedProject = '';
let chatSearch = '';
let selectedChat = null;
let selectedModel = '';
let aiSending = false;
let aiDraft = '';
let aiAttachments = [];
let aiUploading = false;
let aiPendingTurn = null;
let aiTimingTimer;
let authMode = 'login';
let editingConfig = '';
let sessionRevision = 0;
const roleNames = { admin: '管理员', advisor: '导师', student: '成员' };
const submissionStatuses = ['submitted', 'under_review', 'revision', 'accepted', 'published'];
function canonicalSubmissionStatus(value) {
  return ({ draft: 'submitted', major_revision: 'revision', minor_revision: 'revision' })[value] || value;
}

function navigate(page, keepFileContext = false) {
  if (!currentUser) return;
  closeSettingsMenu();
  componentEnd(null, true);
  navigationEnd(null, true);
  uiResizeEnd(null, true);
  dashboardPointerFinish(null, true);
  if (dashboardSaving && page !== 'dashboard') return toast('正在保存工作台，请稍候');
  if (dashboardDraft && page !== 'dashboard') {
    if (!confirm('工作台调整尚未保存，放弃本次调整并离开？')) return;
    dashboardDraft = null;
    dashboardEditing = false;
    closeModal();
  }
  if (page === 'files' && !keepFileContext) fileContext = null;
  currentPage = page;
  if (page === 'settings') settingsSelection = 'all';
  document.querySelectorAll('[data-page]').forEach(button => button.classList.toggle('active', button.dataset.page === page));
  document.getElementById('crumbTitle').textContent = titles[page] || '工作台';
  document.getElementById('content').innerHTML = render(page);
  if (page === 'files' && fileContext?.kind === 'software') document.getElementById('crumbTitle').textContent = '工具资源';
  filterRows();
  if (page === 'software') updateToolClocks();
  document.querySelector('.main').scrollTo(0, 0);
  toggleMenu(false);
  if (page === 'settings') loadSettings();
  if (page === 'submissions') loadJournalProgress();
  if (page === 'ai') loadAI();
}

async function api(path, method = 'GET', value) {
  let response;
  try {
    response = await fetch(`/api${path}`, { method, credentials: 'same-origin', headers: value === undefined ? {} : { 'Content-Type': 'application/json' }, body: value === undefined ? undefined : JSON.stringify(value), signal: AbortSignal.timeout(105000) });
  } catch { throw new Error('连接中断或超时，请确认服务器仍在运行；稍后刷新可检查操作结果。'); }
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && currentUser) showAuth('login');
    throw Object.assign(new Error(result.error || '操作失败'), { status: response.status });
  }
  return result;
}
async function perform(button, action) {
  if (button?.disabled) return;
  if (button) button.disabled = true;
  try { return await action(); }
  catch (error) {
    toast(error.message);
    if (error.status === 409 && currentUser) await loadState(false).catch(() => {});
  } finally { if (button) button.disabled = false; }
}
function showAuth(mode) {
  closeSettingsMenu();
  settingsSelection = 'all';
  componentEnd(null, true);
  navigationEnd(null, true);
  uiResizeEnd(null, true);
  dashboardPointerFinish(null, true);
  sessionRevision++;
  uploadCancelled = true;
  activeUpload?.abort();
  fileContext = null;
  currentUser = null;
  avatarImage = null;
  avatarChoice++;
  groupChatMessages = [];
  groupChatSending = false;
  groupChatRequest = 0;
  groupChatNonce = '';
  groupChatNonceText = '';
  document.getElementById('groupChatInput').value = '';
  document.getElementById('groupChatMessages').replaceChildren();
  document.getElementById('groupChatSend').disabled = false;
  document.getElementById('groupChatPanel').classList.remove('open');
  document.getElementById('groupChatToggle').setAttribute('aria-expanded', 'false');
  lifeHeroId = '';
  lifeHeroPaused = false;
  toolCategory = '';
  dashboardPreference = { settings: null, version: 0 };
  dashboardDraft = null;
  dashboardSaving = false;
  dashboardEditing = false;
  uiApplySizes();
  selectedChat = null;
  selectedModel = '';
  modelConfigs = [];
  availableProviders = [];
  conversations = [];
  chatProjects = [];
  selectedProject = '';
  chatSearch = '';
  aiDraft = '';
  aiAttachments = [];
  aiUploading = false;
  aiSending = false;
  aiPendingTurn = null;
  clearInterval(aiTimingTimer);
  authMode = mode;
  document.querySelector('.app').hidden = true;
  closeModal();
  const fragment = new URLSearchParams(location.hash.slice(1));
  document.getElementById('authRoot').innerHTML = `<section class="auth-shell"><form class="auth-card" onsubmit="authenticate(event)"><div class="eyebrow">AIXIAOYAN · SHARED WORKSPACE</div><h1>${mode === 'setup' ? '创建课题组工作空间' : mode === 'register' ? '加入课题组' : '欢迎回到爱小研'}</h1><p>${mode === 'setup' ? '首次使用，请用服务器上的初始化口令创建管理员。' : '登录后，与课题组成员共享研究进展。'}</p><div class="form-grid">
    ${mode !== 'login' ? '<div class="field full"><label for="authName">姓名</label><input id="authName" name="name" required maxlength="60" autocomplete="name"></div>' : ''}
    <div class="field full"><label for="authEmail">邮箱</label><input id="authEmail" name="email" type="email" required autocomplete="username"></div>
    <div class="field full"><label for="authPassword">密码${mode !== 'login' ? '（至少 12 个字符）' : ''}</label><input id="authPassword" name="password" type="password" required ${mode !== 'login' ? 'minlength="12"' : ''} maxlength="128" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}"></div>
    ${mode !== 'login' ? `<div class="field full"><label for="authToken">${mode === 'setup' ? '初始化口令（data/setup-token.txt）' : '管理员提供的邀请码'}</label><input id="authToken" name="token" required autocomplete="off" value="${esc(mode === 'register' ? fragment.get('invite') || '' : '')}"></div>` : ''}
    </div><p class="form-error" id="authError" role="alert"></p><button type="submit" class="btn primary">${mode === 'login' ? '登录工作台' : '创建账号并进入'}</button>
    ${mode !== 'setup' ? `<button type="button" class="subtle-link" onclick="showAuth('${mode === 'login' ? 'register' : 'login'}')">${mode === 'login' ? '有邀请码？加入课题组' : '已有账号？返回登录'}</button>` : ''}</form></section>`;
}
async function authenticate(event) {
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector('[type=submit]');
  const revision = sessionRevision;
  button.disabled = true;
  document.getElementById('authError').textContent = '';
  try {
    const result = await api(`/auth/${authMode}`, 'POST', Object.fromEntries(new FormData(form)));
    if (revision !== sessionRevision) return;
    currentUser = result.user;
    history.replaceState(null, '', location.pathname);
    await enterWorkspace();
  } catch (error) { if (revision === sessionRevision && document.getElementById('authError')) document.getElementById('authError').textContent = error.message; }
  finally { button.disabled = false; }
}
async function enterWorkspace() {
  await loadState(false);
  document.getElementById('authRoot').innerHTML = '';
  document.querySelector('.app').hidden = false;
  navigate('dashboard');
  loadGroupChat();
}
let groupChatMessages = [];
let groupChatSending = false;
let groupChatRequest = 0;
let groupChatNonce = '';
let groupChatNonceText = '';
function toggleGroupChat(open) {
  const panel = document.getElementById('groupChatPanel');
  const expanded = open ?? !panel.classList.contains('open');
  panel.classList.toggle('open', expanded);
  document.getElementById('groupChatToggle').setAttribute('aria-expanded', String(expanded));
  if (expanded) { loadGroupChat(); document.getElementById('groupChatInput').focus(); }
  else document.getElementById('groupChatToggle').focus();
}
async function loadGroupChat() {
  if (!currentUser || groupChatRequest) return;
  const revision = sessionRevision;
  groupChatRequest = revision + 1;
  try {
    const result = await api('/group-chat');
    if (revision !== sessionRevision || !currentUser) return;
    const area = document.getElementById('groupChatMessages');
    const bottom = !groupChatMessages.length || area.scrollHeight - area.scrollTop - area.clientHeight < 60;
    if (JSON.stringify(result.messages) !== JSON.stringify(groupChatMessages) || !area.children.length) {
      groupChatMessages = result.messages;
      area.innerHTML = groupChatMessages.map(message => `<article class="group-message ${message.owner === currentUser.id ? 'mine' : ''}"><div class="avatar group-message-avatar">${avatarContents(message)}</div><div class="group-message-body"><div class="group-message-meta"><strong>${esc(message.name)}</strong><time datetime="${esc(message.created)}">${esc(new Date(message.created).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}</time></div><p>${esc(message.body)}</p></div></article>`).join('') || '<p class="group-chat-empty">还没有消息，分享一句近况吧。</p>';
      if (bottom) area.scrollTop = area.scrollHeight;
    }
    document.getElementById('groupChatStatus').textContent = '全组共享 · 已同步';
  } catch (error) {
    if (revision === sessionRevision && currentUser) document.getElementById('groupChatStatus').textContent = '暂未连接 · 稍后重试';
  } finally { if (groupChatRequest === revision + 1) groupChatRequest = 0; }
}
async function sendGroupChat(event) {
  event.preventDefault();
  if (!currentUser || groupChatSending) return;
  const input = document.getElementById('groupChatInput');
  const message = input.value.trim();
  if (!message) return;
  if (!groupChatNonce || groupChatNonceText !== message) {
    const hex = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
    groupChatNonce = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
    groupChatNonceText = message;
  }
  const revision = sessionRevision;
  const button = document.getElementById('groupChatSend');
  groupChatSending = true; button.disabled = true;
  try {
    await api('/group-chat', 'POST', { message, clientId: groupChatNonce });
    if (revision !== sessionRevision || !currentUser) return;
    if (input.value.trim() === message) input.value = '';
    groupChatNonce = ''; groupChatNonceText = '';
    await loadGroupChat();
  } catch (error) { if (revision === sessionRevision && currentUser) toast(error.message); }
  finally { if (revision === sessionRevision) { groupChatSending = false; button.disabled = false; } }
}
function chatEnter(event) {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  const input = event.target;
  if (event.repeat || (!input.value.trim() && !(input.id === 'chatText' && aiAttachments.length)) || input.form.querySelector('[type="submit"]').disabled) return;
  input.form.requestSubmit();
}
setInterval(() => { if (currentUser && !document.hidden) loadGroupChat(); }, 4000);
function updateIdentity() {
  document.querySelector('.profile strong').textContent = currentUser.name;
  document.querySelector('.profile small').textContent = roleNames[currentUser.role];
  document.querySelectorAll('.profile .avatar, .top-actions > .avatar').forEach(x => {
    x.innerHTML = avatarContents(currentUser); x.onclick = avatarDialog; x.tabIndex = 0;
    x.setAttribute('role', 'button'); x.setAttribute('aria-label', '编辑个人头像'); x.title = '点击编辑头像';
    x.onkeydown = event => { if (['Enter',' '].includes(event.key)) { event.preventDefault(); avatarDialog(); } };
  });
}
async function loadState(rerender = true) {
  const revision = sessionRevision;
  const result = await api('/state');
  if (revision !== sessionRevision) return;
  const changed = JSON.stringify(data) !== JSON.stringify(result.data);
  const incomingDashboard = result.dashboard || { settings: null, version: 0 };
  const dashboardChanged = incomingDashboard.version >= dashboardPreference.version && JSON.stringify(dashboardPreference) !== JSON.stringify(incomingDashboard);
  if (dashboardChanged) dashboardPreference = incomingDashboard;
  uiApplySizes();
  data = result.data;
  storageInfo = result.storage || storageInfo;
  currentUser = result.user || currentUser;
  const indicator = document.getElementById('connectionStatus');
  if (indicator) { indicator.textContent = '已同步'; indicator.classList.remove('offline'); indicator.title = `最近同步：${new Date().toLocaleTimeString('zh-CN')}`; }
  updateIdentity();
  if (rerender && !componentDrag && !uiResizeState && (changed || (['dashboard', 'software'].includes(currentPage) && dashboardChanged)) && !dashboardDraft && !['ai', 'settings'].includes(currentPage) && !document.querySelector('.modal')) {
    const query = document.querySelector('.local-search')?.value || '';
    const filter = document.querySelector('.filter-select')?.value || '';
    const top = document.querySelector('.main').scrollTop;
    document.getElementById('content').innerHTML = render(currentPage);
    if (document.querySelector('.local-search')) document.querySelector('.local-search').value = query;
    if (document.querySelector('.filter-select')) document.querySelector('.filter-select').value = filter;
    filterRows(query);
    if (currentPage === 'software') updateToolClocks();
    document.querySelector('.main').scrollTop = top;
  }
  if (currentPage === 'submissions') loadJournalProgress();
}
async function boot() {
  document.querySelector('.app').hidden = true;
  if (location.protocol === 'file:') {
    document.getElementById('authRoot').innerHTML = '<section class="auth-shell"><div class="auth-card"><h1>多人版需要启动服务器</h1><p>请双击项目中的“打开网页版.cmd”，它会启动共享服务并打开登录页面。</p><p>旧版浏览器里的记录可以先导出，再由管理员导入工作空间。</p><button class="btn" onclick="exportLegacy()">导出此浏览器的旧版记录</button></div></section>';
    return;
  }
  try {
    const status = await api('/auth/status');
    if (status.user) { currentUser = status.user; await enterWorkspace(); }
    else showAuth(status.needsSetup ? 'setup' : location.hash.includes('invite=') ? 'register' : 'login');
  } catch (error) {
    document.getElementById('authRoot').innerHTML = `<section class="auth-shell"><div class="auth-card"><h1>暂时无法连接工作空间</h1><p>${esc(error.message)}</p><button class="btn" onclick="boot()">重新连接</button></div></section>`;
  }
}
setInterval(() => {
  if (currentUser && !document.hidden) loadState().catch(error => {
    const connection = document.getElementById('connectionStatus');
    if (connection) { connection.textContent = '连接中断'; connection.classList.add('offline'); connection.title = error.message; }
    const indicator = document.getElementById('syncIndicator');
    if (indicator) indicator.textContent = error.message;
  });
}, 15000);

function filterRows(query = document.querySelector('.local-search')?.value || '') {
  const selected = currentPage === 'software' ? toolCategory : document.querySelector('.filter-select')?.value || '';
  document.querySelectorAll('#dataTable tbody tr, #resourceCards [data-search]').forEach(row => {
    const category = row.dataset.status ? canonicalSubmissionStatus(row.dataset.status) : row.dataset.category;
    row.style.display = row.dataset.search.includes(query.toLowerCase()) && (!selected || category === selected) ? '' : 'none';
  });
  showEmpty('#tableEmpty', '#dataTable tbody tr');
  showEmpty('#cardsEmpty', '#resourceCards [data-search]');
}
function filterStatus() { filterRows(); }
function filterCategory() { filterRows(); }
async function submitModal(event, kind) {
  event.preventDefault();
  const form = event.target;
  await perform(form.querySelector('[type=submit]'), async () => {
    const value = Object.fromEntries(new FormData(form));
    if (kind === 'submissions') { value.date ||= new Date().toISOString().slice(0, 10); value.author ||= currentUser.name; }
    const recordId = form.dataset.recordId;
    if (recordId) value.version = Number(form.dataset.version);
    await api(`/records/${kind}${recordId ? '/' + recordId : ''}`, recordId ? 'PATCH' : 'POST', value);
    await loadState(false);
    closeModal();
    navigate(kind);
    toast('已保存，课题组成员可见');
  });
}
let lifeAlbumIndex = 0;
let lifeHeroId = '';
let lifeHeroPaused = false;
function lifeHeroPhotos() {
  return data.life.flatMap(record => lifePhotos(record).map(file => ({ ...file, album: record.title })));
}
function lifeHero() {
  const photos = lifeHeroPhotos();
  const actions = '<button class="btn" onclick="lifeHeroOpenAlbum()">浏览相册 ↗</button>';
  if (!photos.length) return '<section class="life-hero life-hero-empty"><div class="life-hero-copy"><div class="eyebrow">LAB GALLERY</div><h2>课题组影像</h2><p>为生活记录上传照片后，会在这里循环展示。</p></div></section>';
  const index = Math.max(0, photos.findIndex(file => file.id === lifeHeroId));
  const photo = photos[index];
  lifeHeroId = photo.id;
  return `<section class="life-hero" aria-label="课题组照片循环展示组件"><img class="life-hero-image active" src="/api/files/${photo.id}/preview" alt="" decoding="async"><img class="life-hero-image" alt="" decoding="async"><div class="life-hero-shade"></div><div class="life-hero-copy"><div class="eyebrow">LAB LIFE · OUR MOMENTS</div><h2>课题组影像</h2><p>${photos.length} 张照片 · 循环记录我们的日常</p>${actions}</div><div class="life-hero-bottom"><span class="life-hero-caption">${esc(photo.album)} · ${index + 1} / ${photos.length}</span><div class="life-hero-controls"><button onclick="lifeHeroStep(-1)" aria-label="上一张背景">←</button><button class="life-hero-pause" onclick="lifeHeroToggle()" aria-label="${lifeHeroPaused ? '播放背景轮播' : '暂停背景轮播'}">${lifeHeroPaused ? '播放' : '暂停'}</button><button onclick="lifeHeroStep(1)" aria-label="下一张背景">→</button></div></div></section>`;
}
function lifeHeroOpenAlbum() {
  const photo = lifeHeroPhotos().find(file => file.id === lifeHeroId);
  const index = photo ? data.life.findIndex(record => record.id === photo.record_id) : -1;
  if (index >= 0) lifeAlbum(index);
}
function lifeHeroToggle() {
  lifeHeroPaused = !lifeHeroPaused;
  const button = document.querySelector('.life-hero-pause');
  if (button) { button.textContent = lifeHeroPaused ? '播放' : '暂停'; button.setAttribute('aria-label', lifeHeroPaused ? '播放背景轮播' : '暂停背景轮播'); }
}
function lifeHeroStep(direction) {
  const hero = document.querySelector('.life-hero');
  const photos = lifeHeroPhotos();
  if (!hero || photos.length < 2 || hero.dataset.loading) return;
  const index = (Math.max(0, photos.findIndex(file => file.id === lifeHeroId)) + direction + photos.length) % photos.length;
  const photo = photos[index];
  const active = hero.querySelector('.life-hero-image.active');
  const next = hero.querySelector('.life-hero-image:not(.active)');
  hero.dataset.loading = 'true';
  next.onload = () => {
    delete hero.dataset.loading;
    if (!hero.isConnected) return;
    lifeHeroId = photo.id;
    next.classList.add('active'); active.classList.remove('active');
    hero.querySelector('.life-hero-caption').textContent = `${photo.album} · ${index + 1} / ${photos.length}`;
  };
  next.onerror = () => { delete hero.dataset.loading; };
  next.src = `/api/files/${photo.id}/preview`;
}
setInterval(() => {
  const hero = document.querySelector('.life-hero');
  if (currentUser && currentPage === 'life' && !document.hidden && !lifeHeroPaused && !document.querySelector('.modal') && hero && !hero.matches(':hover, :focus-within') && hero.getBoundingClientRect().bottom > 0 && !matchMedia('(prefers-reduced-motion: reduce)').matches) lifeHeroStep(1);
}, 6000);
let lifePhotoIndex = 0;
function lifePhotos(record) {
  return (data.files || []).filter(file => file.kind === 'life' && file.record_id === record.id && /\.(jpe?g|png|gif|webp|heic)$/i.test(file.name)).sort((a, b) => a.name.localeCompare(b.name));
}
function lifeAlbum(index) {
  const record = data.life[index];
  if (!record) return;
  lifeAlbumIndex = index;
  const photos = lifePhotos(record);
  document.getElementById('modalRoot').innerHTML = `<div class="overlay" onclick="if(event.target===this)closeModal()"><section class="modal photo-album" role="dialog" aria-modal="true" aria-labelledby="albumTitle" onkeydown="if(event.key==='Escape')closeModal()"><div class="modal-head"><div><h2 id="albumTitle">${esc(record.title)}</h2><p>${photos.length} 张照片 · 点击照片放大</p></div><button class="close" aria-label="关闭相册" onclick="closeModal()">×</button></div><div class="photo-grid">${photos.map((file, i) => `<button class="photo-tile" onclick="lifePhoto(${i})" aria-label="查看 ${esc(file.name)}"><img src="/api/files/${file.id}/preview?size=thumb" loading="lazy" decoding="async" alt="${esc(file.name)}" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span hidden>预览暂不可用，点击下载原图</span><small>${esc(file.name)}</small></button>`).join('') || '<p>还没有可浏览的照片。</p>'}</div><div class="modal-actions"><button class="btn primary" onclick="closeModal();openRecordFiles('life',${index})">上传 / 管理照片</button><button class="btn" onclick="closeModal()">关闭</button></div></section></div>`;
  document.querySelector('.photo-album .close').focus();
}
function lifePhoto(index) {
  const record = data.life[lifeAlbumIndex];
  if (!record) return;
  const photos = lifePhotos(record);
  if (!photos.length) return;
  lifePhotoIndex = (index + photos.length) % photos.length;
  const file = photos[lifePhotoIndex];
  document.getElementById('modalRoot').innerHTML = `<div class="overlay" onclick="if(event.target===this)closeModal()"><section class="modal photo-viewer" role="dialog" aria-modal="true" aria-labelledby="photoTitle" onkeydown="photoKey(event)"><div class="modal-head"><div><h2 id="photoTitle">${esc(record.title)}</h2><p>${lifePhotoIndex + 1} / ${photos.length} · ${esc(file.name)}</p></div><button class="close" aria-label="关闭照片" onclick="closeModal()">×</button></div><div class="photo-stage"><img src="/api/files/${file.id}/preview" alt="${esc(file.name)}" decoding="async" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><p hidden>暂时无法预览，可下载原图查看。</p></div><div class="modal-actions"><button class="btn" onclick="lifeAlbum(lifeAlbumIndex)">返回相册</button><button class="btn" onclick="lifePhoto(lifePhotoIndex-1)">← 上一张</button><button class="btn" onclick="lifePhoto(lifePhotoIndex+1)">下一张 →</button><a class="btn primary" href="/api/files/${file.id}" download>下载原图</a></div></section></div>`;
  document.querySelector('.photo-viewer .close').focus();
}
function photoKey(event) {
  if (event.key === 'Escape') closeModal();
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    lifePhoto(lifePhotoIndex + (event.key === 'ArrowLeft' ? -1 : 1));
  }
}
function yearOptions(records) {
  return [...new Set(records.map(record => record.year).filter(Boolean))].sort().reverse().map(year => `<option>${esc(year)}</option>`).join('');
}
function recordDialog(kind, index) {
  const record = data[kind][index];
  if (!record) return;
  openModal(kind);
  const form = document.querySelector('.modal');
  const editable = currentUser.role !== 'student' || record.owner === currentUser.id;
  form.dataset.recordId = record.id;
  form.dataset.version = record.version;
  form.querySelector('h2').textContent = editable ? '查看与编辑记录' : '查看记录';
  for (const field of form.querySelectorAll('[name]')) {
    let value = record[field.name];
    if (kind === 'submissions' && field.name === 'status') value = canonicalSubmissionStatus(record.status);
    if (kind === 'software' && field.name === 'color') value = toolAppearance(record).color;
    if (field.tagName === 'SELECT' && !Array.from(field.options).some(option => option.value === value)) field.add(new Option(statusLabel(value), value));
    field.value = value || '';
    field.disabled = !editable;
  }
  if (!editable) form.querySelector('[type=submit]').remove();
  const attachments = (data.files || []).filter(file => file.record_id === record.id).length;
  const actions = form.querySelector('.modal-actions');
  const filesButton = document.createElement('button');
  filesButton.type = 'button'; filesButton.className = 'btn'; filesButton.textContent = `关联文件（${attachments}）`;
  filesButton.onclick = () => { closeModal(); fileContext = { kind, id: record.id, title: record.title }; navigate('files', true); };
  actions.prepend(filesButton);
  if (editable) {
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'mini-btn'; remove.textContent = '删除记录';
    remove.onclick = () => {
      if (!confirm('删除此记录？关联文件会保留在共享文件中。')) return;
      perform(remove, async () => { await api(`/records/${kind}/${record.id}`, 'DELETE', { version: record.version }); closeModal(); await loadState(false); navigate(kind); toast('记录已删除，关联文件已保留'); });
    };
    actions.prepend(remove);
  }
}
function toolGuideDialog(index) {
  const tool = data.software[index];
  if (!tool) return;
  const editable = currentUser.role !== 'student' || tool.owner === currentUser.id;
  const instructions = tool.instructions?.trim();
  const platformGuide = '1. 点击“工具资源”，查看此工具关联的程序、脚本、示例数据或教程附件。\n2. 下载需要的资源；若列表为空，请联系上传者补充。\n3. 使用前核对工具版本、适用系统和所需环境，以工具教程或提供者的说明为准。\n4. 若运行报错，请记录报错内容、操作步骤和工具版本，联系工具提供者。';
  document.getElementById('modalRoot').innerHTML = `<div class="overlay" onclick="if(event.target===this)closeModal()"><section class="modal tool-guide" role="dialog" aria-modal="true" aria-labelledby="toolGuideTitle" onkeydown="if(event.key==='Escape')closeModal()"><div class="modal-head"><h2 id="toolGuideTitle">${esc(tool.title)} · 使用说明</h2><button type="button" class="close" aria-label="关闭使用说明" onclick="closeModal()">×</button></div>${tool.description ? `<p>${esc(tool.description)}</p>` : ''}${instructions ? '' : '<div class="notice">具体操作教程尚未填写。以下为平台内资源查找与下载步骤。</div>'}<div class="tool-guide-body">${esc(instructions || platformGuide)}</div><div class="modal-actions"><button type="button" class="btn" onclick="closeModal();openRecordFiles('software',${index})">工具资源</button>${editable ? `<button type="button" class="btn primary" onclick="editToolGuide(${index})">${instructions ? '编辑说明' : '填写说明'}</button>` : ''}<button type="button" class="btn" onclick="closeModal()">关闭</button></div></section></div>`;
  document.querySelector('.tool-guide .close').focus();
}
function editToolGuide(index) {
  recordDialog('software', index);
  document.querySelector('.modal [name="instructions"]')?.focus();
}
async function removeItem(kind, index) {
  const record = data[kind][index];
  if (!record || !confirm(`确定删除“${record.title}”吗？此操作会影响共享工作空间。`)) return;
  await perform(null, async () => {
    await api(`/records/${kind}/${record.id}`, 'DELETE', { version: record.version });
    await loadState(false);
    navigate(kind);
    toast('已删除共享记录');
  });
}
function cycleStatus(index) {
  const record = data.submissions[index];
  document.getElementById('modalRoot').innerHTML = `<div class="overlay"><form class="modal" onsubmit="updateStatus(event,'${record.id}',${record.version})"><div class="modal-head"><h2>更新投稿状态</h2><button type="button" class="close" onclick="closeModal()">×</button></div><p>${esc(record.title)}</p><div class="field"><label>状态</label><select name="status" required><option value="">请选择状态</option>${submissionStatuses.map(x => `<option value="${x}" ${x === canonicalSubmissionStatus(record.status) ? 'selected' : ''}>${statusLabel(x)}</option>`).join('')}</select></div><div class="modal-actions"><button type="submit" class="btn primary">保存状态</button></div></form></div>`;
}
async function updateStatus(event, recordId, version) {
  event.preventDefault();
  await perform(event.target.querySelector('[type=submit]'), async () => {
    await api(`/records/submissions/${recordId}`, 'PATCH', { version, status: new FormData(event.target).get('status') });
    await loadState(false); closeModal(); navigate('submissions'); toast('投稿状态已同步');
  });
}
function membersPage() {
  return `${header('OUR TEAM', '课题组成员', '同一工作空间，共享研究记录与协作进展。', currentUser.role === 'admin' ? '<button class="btn primary" onclick="inviteDialog()">＋ 邀请成员</button>' : '')}<div class="notice">成员可以维护自己的记录；导师和管理员可以维护全组记录。AI 对话仅本人可见。</div><div class="grid member-grid">${data.members.map(x => `<article class="card member-card" data-component-id="${x.id}"><div class="avatar">${avatarContents(x)}</div><strong>${esc(x.name)}</strong><p>${esc(x.email)}</p><span class="tag">${roleNames[x.role]}</span>${x.field ? `<p>${esc(x.field)}</p>` : ''}</article>`).join('')}</div>`;
}
function inviteDialog() {
  document.getElementById('modalRoot').innerHTML = `<div class="overlay"><form class="modal" onsubmit="createInvite(event)"><div class="modal-head"><h2>邀请课题组成员</h2><button type="button" class="close" onclick="closeModal()">×</button></div><div class="field"><label>加入后的角色</label><select name="role"><option value="student">成员：维护自己的记录</option><option value="advisor">导师：维护全组记录</option></select></div><p>每个邀请码可使用一次，七天后过期。</p><div id="inviteResult"></div><div class="modal-actions"><button type="submit" class="btn primary">生成邀请码</button></div></form></div>`;
}
async function createInvite(event) {
  event.preventDefault();
  await perform(event.target.querySelector('[type=submit]'), async () => {
    const result = await api('/invites', 'POST', Object.fromEntries(new FormData(event.target)));
    const url = `${location.origin}/#invite=${result.token}`;
    document.getElementById('inviteResult').innerHTML = `<p>将邀请码发给成员，让对方在共享网址注册。</p><div class="field"><label>邀请码</label><input readonly value="${result.token}" onclick="this.select()"></div><div class="field"><label>邀请链接（需使用成员可访问的服务器地址）</label><input readonly value="${esc(url)}" onclick="this.select()"></div>`;
  });
}
function settingsPage() {
  return `${header('WORKSPACE SETTINGS', '账号与 AI 设置', '管理个人模型、共享模型以及课题组访问权限。')}<div id="settingsViewTools" class="settings-view-tools" hidden><button class="btn" onclick="settingsSelect('all')">显示全部模块</button></div><div class="settings-stack"><section class="card section-card" id="settingsAccount" data-settings-section="account"><div class="section-head"><h2>个人账号与资料</h2></div><div class="page-tools"><button class="btn" onclick="avatarDialog()">编辑头像</button><button class="btn" onclick="changePasswordDialog()">修改密码</button><button class="btn" onclick="exportWorkspace()">导出共享资料</button>${currentUser.role === 'admin' ? '<label class="btn">导入旧版资料<input type="file" accept=".json" hidden onchange="importWorkspace(this)"></label>' : ''}<button class="btn" onclick="logout()">退出登录</button></div><div class="notice" id="syncIndicator">共享资料每 15 秒刷新；记录修改带版本校验，避免覆盖其他成员的修改。</div></section>${currentUser.role === 'admin' ? `${freeGatewayPanel()}${mailboxPanel()}` : ''}<section class="card section-card" id="settingsModels" data-settings-section="models"><div class="section-head"><div><h2>AI 模型配置</h2><p>个人配置仅本人可用；管理员可为全组配置共享模型。</p></div><button class="btn primary" onclick="configDialog()">＋ 添加模型</button></div><p>请填写平台提供的 API Key 和模型 ID。密钥不会回传到浏览器；对话费用由所选密钥所属账号承担。</p><div id="modelList">正在读取模型配置…</div></section>${currentUser.role === 'admin' ? '<section class="card section-card account-panel" id="settingsMembers" data-settings-section="members"><h2>成员权限</h2><div id="accountList">正在读取成员…</div></section>' : ''}</div>`;
}
async function loadSettings() {
  const revision = sessionRevision;
  if (currentUser.role === 'admin') { loadFreeGateway(); loadMailbox(); }
  await perform(null, async () => {
    const [providers, configs] = await Promise.all([api('/ai/providers'), api('/ai/configs')]);
    if (revision !== sessionRevision) return;
    availableProviders = providers.providers; modelConfigs = configs.configs;
    if (currentPage !== 'settings') return;
    document.getElementById('modelList').innerHTML = modelConfigs.map(x => x.id === 'xiaoyan-auto' ? `<div class="setting-row"><div><strong>小研AI</strong><small>系统自动调度免费模型 · 全组共享</small></div><span class="tag">自动运行</span></div>` : `<div class="setting-row"><div><strong>${esc(x.label)}</strong><small>${esc(x.provider)} · ${esc(x.model)} · ${x.scope === 'global' ? '全组共享' : '个人'} · ${x.enabled ? '启用' : '停用'}</small></div>${x.scope === 'personal' || currentUser.role === 'admin' ? `<div class="row-actions"><button class="mini-btn" onclick="testModel(this,'${x.id}')">测试连接</button><button class="mini-btn" onclick="configDialog('${x.id}')">编辑</button><button class="mini-btn" onclick="toggleConfig(this,'${x.id}',${!x.enabled})">${x.enabled ? '停用' : '启用'}</button><button class="mini-btn" onclick="deleteConfig(this,'${x.id}')">删除</button></div>` : '<span class="tag">管理员维护</span>'}</div>`).join('') || '<div class="empty">还没有模型配置。请管理员配置小研AI，或添加个人模型。</div>';
    document.getElementById('modelList').insertAdjacentHTML('beforeend', `<p class="model-limit">每位成员每天最多 ${providers.dailyLimit} 次请求，连接测试也计入。</p>`);
    if (currentUser.role === 'admin') {
      const result = await api('/users');
      if (currentPage !== 'settings' || revision !== sessionRevision) return;
      document.getElementById('accountList').innerHTML = result.users.map(x => `<div class="setting-row"><div><strong>${esc(x.name)}</strong><small>${esc(x.email)} · ${x.active ? '启用' : '停用'}</small></div><div class="row-actions"><select class="filter-select" aria-label="${esc(x.name)}的角色" onchange="changeMember(this,'${x.id}',{role:this.value})">${Object.entries(roleNames).map(([key,label]) => `<option value="${key}" ${key === x.role ? 'selected' : ''}>${label}</option>`).join('')}</select><button class="mini-btn" onclick="changeMember(this,'${x.id}',{active:${!x.active}})">${x.active ? '停用' : '启用'}</button></div></div>`).join('');
    }
  });
}
function mailboxPanel() {
  return `<section class="card section-card" id="mailboxPanel" data-settings-section="mailbox"><div class="section-head"><div><h2>投稿邮箱</h2><p>仅管理员可配置 · 163 IMAP · 读取邮件内容判断进度，自动更新</p></div><span class="tag gray" id="mailboxState">读取状态中</span></div><form class="form-grid" onsubmit="saveMailbox(event)"><div class="field full"><label for="mailboxEmail">163 邮箱</label><input id="mailboxEmail" name="email" type="email" required value="your-email@example.com" autocomplete="username"></div><div class="field full"><label for="mailboxPassword">客户端授权码</label><input id="mailboxPassword" name="appPassword" type="password" required maxlength="200" autocomplete="new-password" placeholder="在 163 邮箱设置中生成，不是邮箱登录密码"></div><div class="field full"><small>首次配置后只检查新到邮件，每 5 分钟一次。授权码加密保存在服务器；正文仅用于识别与匹配，服务器只保存邮件标题、发件人、时间和建议状态，也不会标记已读、移动或删除邮件。</small></div><div class="field full row-actions"><button class="btn primary" type="submit">验证并保存</button><button class="btn" id="removeMailbox" type="button" hidden onclick="removeMailboxConfig(this)">移除邮箱配置</button></div></form></section>`;
}
async function loadMailbox() {
  const target = document.getElementById('mailboxState');
  if (!target) return;
  try {
    const { mailbox } = await api('/mailbox');
    if (!target.isConnected) return;
    document.getElementById('mailboxEmail').value = mailbox.email;
    target.textContent = mailbox.configured ? (mailbox.last_error ? '检查出错' : '监控已开启') : '尚未配置';
    target.className = `tag ${mailbox.configured ? 'green' : 'gray'}`;
    document.getElementById('removeMailbox').hidden = !mailbox.configured;
  } catch (error) { if (target.isConnected) target.textContent = error.message; }
}
async function saveMailbox(event) {
  event.preventDefault();
  await perform(event.target.querySelector('[type=submit]'), async () => {
    await api('/mailbox', 'PUT', Object.fromEntries(new FormData(event.target)));
    event.target.reset();
    await loadMailbox();
    toast('投稿邮箱连接验证成功，授权码已加密保存');
  });
}
async function removeMailboxConfig(button) {
  if (!confirm('移除投稿邮箱配置？服务器将不再保留此邮箱授权码。')) return;
  await perform(button, async () => { await api('/mailbox', 'DELETE', {}); await loadMailbox(); toast('邮箱配置已移除'); });
}
function journalStage(row, status) {
  const mail = row.stageMail?.[status];
  return `<li class="${row.status === status ? 'active' : ''}" ${row.status === status ? 'aria-current="step"' : ''}><button type="button" data-mail-id="${esc(mail?.id || '')}" onclick="openJournalMail(this.dataset.mailId)" ${mail ? 'title="查看对应原邮件"' : 'disabled'}><span class="journal-stage-dot" aria-hidden="true"></span>${esc(statusLabel(status))}</button></li>`;
}
async function openJournalMail(messageId) {
  if (currentUser?.role !== 'admin') return toast('原邮件仅管理员可查看');
  const revision = sessionRevision;
  document.getElementById('modalRoot').innerHTML = `<div class="overlay" onclick="if(event.target===this)closeModal()"><section class="modal journal-reader" role="dialog" aria-modal="true" aria-labelledby="journalMailTitle"><div class="modal-head"><h2 id="journalMailTitle">邮件详情</h2><button type="button" class="close" aria-label="关闭邮件" onclick="closeModal()">×</button></div><div id="journalMailBody" aria-live="polite">正在从邮箱读取原邮件…</div><div class="modal-actions"><a class="btn" href="https://mail.163.com/" target="_blank" rel="noopener noreferrer">打开网易邮箱</a><button type="button" class="btn" onclick="closeModal()">关闭</button></div></section></div>`;
  const target = document.getElementById('journalMailBody');
  target.closest('.journal-reader').querySelector('.close').focus();
  try {
    const { message } = await api(`/mailbox/messages/${messageId}`);
    if (revision !== sessionRevision || !target.isConnected) return;
    document.getElementById('journalMailTitle').textContent = message.subject;
    target.innerHTML = `<div class="journal-reader-meta"><p>发件人：${esc(message.sender || '未知')}</p><p>时间：${message.received ? esc(new Date(message.received).toLocaleString('zh-CN')) : '未知'}</p></div>${message.truncated ? '<p class="notice">邮件较大，当前展示可读取的正文；完整内容请到网易邮箱查看。</p>' : ''}<div class="journal-reader-text">${esc(message.text || '此邮件没有可显示的文字正文，请到网易邮箱查看。')}</div>`;
  } catch (error) { if (revision === sessionRevision && target.isConnected) target.textContent = error.message; }
}
async function loadJournalProgress() {
  const target = document.getElementById('journalProgress');
  if (!target || componentDrag || uiResizeState) return;
  const revision = sessionRevision;
  try {
    const result = await api('/mailbox/journals');
    if (revision !== sessionRevision || !target.isConnected) return;
    target.innerHTML = result.journals.map(row => `<article class="card journal-card" data-component-id="journal-${row.id}"><div class="journal-card-top"><h2>${esc(row.journal)}</h2><ol class="journal-stages" aria-label="当前进度：${row.status ? esc(statusLabel(row.status)) : '暂无明确进度'}">${submissionStatuses.map(status => journalStage(row, status)).join('')}</ol></div><ul class="journal-mail-list">${row.messages.map(mail => `<li class="journal-mail"><div><button type="button" class="journal-mail-open" data-mail-id="${esc(mail.id)}" onclick="openJournalMail(this.dataset.mailId)" title="查看原邮件"><p>${esc(mail.subject)}</p></button></div><time datetime="${esc(mail.received)}">${esc(new Date(mail.received).toLocaleString('zh-CN'))}</time></li>`).join('')}</ul></article>`).join('') || '<div class="empty">暂未检测到期刊投稿邮件</div>';
    const monitor = document.getElementById('journalMonitorStatus');
    if (monitor) {
      const mailbox = result.mailbox;
      monitor.textContent = mailbox.last_error || (!mailbox.enabled ? '尚未开启邮箱监控' : `自动监控中${mailbox.last_checked ? ` · 最近检查 ${new Date(mailbox.last_checked).toLocaleString('zh-CN')}` : ''}`);
    }
  } catch (error) { if (target.isConnected) target.textContent = error.message; }
}
function freeGatewayPanel() {
  return `<section class="card section-card" id="freeGateway" data-settings-section="gateway"><div class="section-head"><div><h2>小研AI</h2><p>课题组统一 AI 入口 · 免费模型自动调度 · 全组共享</p></div><button class="btn" onclick="loadFreeGateway()">刷新状态</button></div><div id="freeGatewayBody">正在读取小研AI状态…</div></section>`;
}
async function loadFreeGateway() {
  const revision = sessionRevision;
  const target = document.getElementById('freeGatewayBody');
  if (!target) return;
  target.textContent = '正在读取小研AI状态…';
  try {
    const result = await api('/ai/gateway');
    if (!target.isConnected || revision !== sessionRevision) return;
    if (!result.connected) { target.textContent = result.notice; return; }
    target.innerHTML = `<div class="notice">后台已连接 · ${result.configured ? '平台密钥已保存，小研AI 正在自动调度免费模型。' : '小研AI 暂无已启用的模型密钥。'}<br>系统不会在免费模型不可用时切换至付费模型。</div><p>管理员集中维护平台密钥；组员只需在「AI 助手」选择小研AI，无需选择模型或填写密钥。对话内容会发送至实际提供回复的模型服务商。</p>${result.notice ? `<p>${esc(result.notice)}</p>` : ''}${result.configured ? '<button class="btn" type="button" onclick="disconnectFreeGateway(this)">移除小研AI平台密钥</button>' : ''}`;
  } catch (error) { if (target.isConnected && revision === sessionRevision) target.textContent = error.message; }
}
async function saveFreeGateway(event) {
  event.preventDefault();
  await perform(event.target.querySelector('[type=submit]'), async () => {
    await api('/ai/gateway', 'POST', Object.fromEntries(new FormData(event.target)));
    event.target.reset();
    await loadSettings();
    toast('小研AI 模型池已更新');
  });
}
async function disconnectFreeGateway(button) {
  if (!confirm('移除小研AI平台密钥及自动调度配置？已有对话记录会保留。')) return;
  await perform(button, async () => { await api('/ai/gateway', 'DELETE', {}); await loadSettings(); toast('平台密钥已移除'); });
}
function configDialog(configId = '') {
  if (!availableProviders.length) { toast('请等待平台配置加载完成'); return; }
  editingConfig = configId;
  const config = modelConfigs.find(x => x.id === configId);
  if (config?.provider === 'freellmapi') { document.getElementById('freeGateway')?.scrollIntoView({ behavior: 'smooth' }); return; }
  document.getElementById('modalRoot').innerHTML = `<div class="overlay"><form class="modal" onsubmit="saveConfig(event)"><div class="modal-head"><h2>${config ? '编辑模型' : '添加 AI 模型'}</h2><button type="button" class="close" onclick="closeModal()">×</button></div><div class="form-grid"><div class="field"><label>显示名称</label><input name="label" required maxlength="80" value="${esc(config?.label || '')}" placeholder="例如：课题组写作助手"></div><div class="field"><label>平台</label><select name="provider" onchange="updateBaseOptions()">${availableProviders.map(x => `<option value="${x.id}" ${x.id === config?.provider ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div><div class="field full"><label>服务地址 / 地区</label><select name="base" id="baseOptions"></select></div><div class="field full"><label>模型 ID（从平台控制台复制）</label><input name="model" required maxlength="180" value="${esc(config?.model || '')}" placeholder="填写已开通的模型名称；豆包也可填写接入点 ID"></div><div class="field full"><label>API Key${config ? '（留空保留原密钥）' : ''}</label><input name="apiKey" type="password" autocomplete="new-password" ${config ? '' : 'required'} maxlength="4096"></div><div class="field full"><label>使用范围</label><select name="scope" ${config ? 'disabled' : ''}><option value="personal" ${config?.scope !== 'global' ? 'selected' : ''}>仅我自己</option>${currentUser.role === 'admin' ? `<option value="global" ${config?.scope === 'global' ? 'selected' : ''}>全课题组共享</option>` : ''}</select></div></div><div class="modal-actions"><button type="submit" class="btn primary">保存模型</button></div></form></div>`;
  updateBaseOptions(config?.base);
}
function updateBaseOptions(selected = '') {
  const provider = availableProviders.find(x => x.id === document.querySelector('.modal [name=provider]').value);
  document.getElementById('baseOptions').innerHTML = provider.bases.map(base => `<option ${base === selected ? 'selected' : ''}>${esc(base)}</option>`).join('');
}
async function saveConfig(event) {
  event.preventDefault();
  await perform(event.target.querySelector('[type=submit]'), async () => {
    const input = Object.fromEntries(new FormData(event.target));
    if (editingConfig) input.scope = modelConfigs.find(x => x.id === editingConfig).scope;
    await api(`/ai/configs${editingConfig ? '/' + editingConfig : ''}`, editingConfig ? 'PATCH' : 'POST', input);
    closeModal(); await loadSettings(); toast('模型配置已保存');
  });
}
async function testModel(button, configId) { await perform(button, async () => { button.textContent = '测试中…'; try { const result = await api(`/ai/configs/${configId}/test`, 'POST', {}); toast(`连接成功：${result.message}`); } finally { button.textContent = '测试连接'; } }); }
async function toggleConfig(button, configId, enabled) { await perform(button, async () => { await api(`/ai/configs/${configId}`, 'PATCH', { enabled }); await loadSettings(); }); }
async function deleteConfig(button, configId) { if (!confirm('确定删除此模型配置吗？')) return; await perform(button, async () => { await api(`/ai/configs/${configId}`, 'DELETE', {}); await loadSettings(); }); }
async function changeMember(button, userId, input) { await perform(button, async () => { await api(`/users/${userId}`, 'PATCH', input); await loadState(false); navigate('settings'); }); }
async function logout() {
  await perform(null, async () => { await api('/auth/logout', 'POST', {}); selectedChat = null; conversations = []; modelConfigs = []; aiDraft = ''; showAuth('login'); });
}
function changePasswordDialog() {
  document.getElementById('modalRoot').innerHTML = '<div class="overlay"><form class="modal" onsubmit="changePassword(event)"><div class="modal-head"><h2>修改密码</h2><button type="button" class="close" onclick="closeModal()">×</button></div><div class="form-grid"><div class="field full"><label>当前密码</label><input type="password" name="current" required autocomplete="current-password"></div><div class="field full"><label>新密码（至少 12 个字符）</label><input type="password" name="password" minlength="12" maxlength="128" required autocomplete="new-password"></div></div><div class="modal-actions"><button type="submit" class="btn primary">保存新密码</button></div></form></div>';
}
async function changePassword(event) { event.preventDefault(); await perform(event.target.querySelector('[type=submit]'), async () => { await api('/auth/password', 'POST', Object.fromEntries(new FormData(event.target))); closeModal(); toast('密码已修改，其他设备需要重新登录'); }); }
function downloadJSON(value, filename) {
  const a = document.createElement('a'); const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportWorkspace() { downloadJSON(Object.fromEntries(Object.entries(data).filter(([key]) => !['members', 'files'].includes(key))), '爱小研共享记录.json'); toast('已导出文字记录；文件附件需单独下载或备份服务器 data 目录'); }
function csvCell(value) {
  let result = String(value ?? '');
  if (/^\s*[=+@-]/.test(result)) result = "'" + result;
  return '"' + result.replaceAll('"', '""') + '"';
}
function exportCsv() {
  const rows = [['标题','目标期刊','负责人','投稿日期','状态','修回截止'], ...data.submissions.map(x => [x.title,x.journal,x.author,x.date,statusLabel(x.status),x.deadline])];
  const content = '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = '投稿记录.csv'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportLegacy() { try { downloadJSON(JSON.parse(localStorage.getItem('qiyan-data') || '{}'), '爱小研旧版资料.json'); } catch { toast('无法读取旧版记录'); } }
async function importWorkspace(input) {
  const file = input.files[0]; if (!file) return;
  if (file.size > 1024 * 1024) { toast('导入文件请控制在 1 MB 内'); input.value = ''; return; }
  await perform(null, async () => {
    const value = JSON.parse(await file.text());
    if (!confirm('将把文件中的记录追加到全组共享资料。重复导入会产生重复记录，继续吗？')) return;
    const result = await api('/import', 'POST', value); await loadState(false); toast(`已导入 ${result.count} 条记录`);
  });
  input.value = '';
}

function aiPage() {
  return `<div class="ai-layout">
    <aside class="chat-sidebar" aria-label="聊天目录">
      <button class="chat-nav-button" onclick="newChat()">＋ 新建聊天</button>
      <input class="chat-search" type="search" aria-label="搜索聊天" placeholder="搜索聊天" value="${esc(chatSearch)}" oninput="chatSearch=this.value;paintChatDirectory()">
      <button class="chat-nav-button" onclick="selectChatProject('')">全部聊天</button>
      <div class="chat-section-heading"><span>项目</span><button class="mini-btn" aria-label="新建项目" onclick="chatProjectDialog()">＋</button></div>
      <div id="chatProjectList"></div>
      <div class="chat-section-heading"><span id="chatHistoryHeading">历史聊天</span></div>
      <div id="chatList"></div>
    </aside>
    <section class="chat-panel" aria-label="AI 对话">
      <div class="chat-toolbar"><div class="chat-toolbar-actions"><select id="chatProjectSelect" aria-label="将当前聊天移动到项目" onchange="moveChatProject(this.value)"></select><button class="mini-btn" id="deleteChatButton" onclick="deleteChat()">删除聊天</button></div></div>
      <div id="chatProjectHeader" class="chat-project-header" hidden></div>
      <div id="messages" class="chat-messages" aria-live="polite"></div>
      <form class="chat-composer" onsubmit="sendMessage(event)"><div id="chatAttachments" class="chat-attachments" hidden></div><label class="sr-only" for="chatText">发送消息给小研AI</label><textarea id="chatText" maxlength="12000" placeholder="发送消息给小研AI" oninput="aiDraft=this.value;updateChatComposer()" onkeydown="chatEnter(event)">${esc(aiDraft)}</textarea><div class="chat-composer-actions"><details class="chat-upload-menu" id="chatUploadMenu"><summary aria-label="添加文件" title="添加文件">＋</summary><div class="chat-upload-options"><button type="button" id="chatUploadButton" onclick="document.getElementById('chatUploadMenu').open=false;document.getElementById('chatFileInput').click()">上传文件<small>PDF、Word、文本 · 每个不超过 8 MB</small></button></div></details><input id="chatFileInput" type="file" accept=".pdf,.docx,.txt,.md,.csv,.json" multiple hidden onchange="uploadChatDocuments(this)"><span id="chatStatus" class="sr-only" role="status"></span><details class="chat-model-picker" id="chatModelMenu"><summary id="chatModel" aria-label="选择模型" onclick="if(aiSending)event.preventDefault()">小研AI <span aria-hidden="true">⌄</span></summary><div id="chatModelOptions" class="chat-model-options" role="menu"></div></details><button type="submit" class="chat-send-button" id="sendButton" aria-label="发送消息" title="发送"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button></div></form>
    </section>
  </div>`;
}
async function loadAI() {
  const revision = sessionRevision;
  await perform(null, async () => {
    const [models, history, projects] = await Promise.all([api('/ai/configs'), api('/chats'), api('/chat-projects')]);
    if (revision !== sessionRevision) return;
    modelConfigs = models.configs; conversations = history.chats;
    chatProjects = projects.projects;
    if (!chatProjects.some(x => x.id === selectedProject)) selectedProject = '';
    if (currentPage !== 'ai') return;
    const enabled = modelConfigs.filter(x => x.enabled);
    if (!enabled.some(x => x.id === selectedModel)) selectedModel = enabled[0]?.id || '';
    const auto = enabled.find(x => x.id === 'xiaoyan-auto');
    if (auto) selectedModel = auto.id;
    paintChat();
  });
}
function paintChatDirectory() {
  if (currentPage !== 'ai') return;
  document.getElementById('chatProjectList').innerHTML = chatProjects.map(x => `<button class="chat-history ${x.id === selectedProject ? 'active' : ''}" onclick="selectChatProject('${x.id}')"><span>▱ ${esc(x.name)}</span><small>${conversations.filter(chat => chat.project_id === x.id).length} 个聊天</small></button>`).join('') || '<p class="chat-directory-empty">创建项目，整理研究对话</p>';
  const project = chatProjects.find(x => x.id === selectedProject);
  document.getElementById('chatHistoryHeading').textContent = project ? '项目聊天' : '历史聊天';
  const history = conversations.filter(x => (!selectedProject || x.project_id === selectedProject) && x.title.toLowerCase().includes(chatSearch.trim().toLowerCase()));
  document.getElementById('chatList').innerHTML = history.map(x => `<button class="chat-history ${x.id === selectedChat?.id ? 'active' : ''}" onclick="openChat('${x.id}')">${esc(x.title)}<small>${esc(x.updated.slice(0, 10))}</small></button>`).join('') || '<p class="chat-directory-empty">暂无聊天</p>';
}
function paintChat(preserveScroll = false) {
  if (currentPage !== 'ai') return;
  const messages = document.getElementById('messages');
  const scrollTop = messages.scrollTop;
  const atBottom = messages.scrollHeight - scrollTop - messages.clientHeight < 80;
  paintChatDirectory();
  const project = chatProjects.find(x => x.id === selectedProject);
  const projectHeader = document.getElementById('chatProjectHeader');
  projectHeader.hidden = !project;
  projectHeader.innerHTML = project ? `<strong>${esc(project.name)}</strong><div><button class="mini-btn" onclick="chatProjectDialog('${project.id}')">重命名</button><button class="mini-btn" onclick="deleteChatProject('${project.id}')">删除项目</button></div>` : '';
  const projectSelect = document.getElementById('chatProjectSelect');
  projectSelect.hidden = !selectedChat;
  projectSelect.innerHTML = '<option value="">未归入项目</option>' + chatProjects.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('');
  projectSelect.value = selectedChat?.project_id || '';
  projectSelect.disabled = aiSending;
  document.getElementById('deleteChatButton').hidden = !selectedChat;
  document.getElementById('deleteChatButton').disabled = aiSending;
  const pending = aiPendingTurn?.chatId === (selectedChat?.id || null) ? aiPendingTurn : null;
  const history = [...(selectedChat?.messages || []), ...(pending ? [pending.user, pending.reply] : [])];
  messages.innerHTML = history.length ? history.map(x => {
    const turn = x === pending?.reply ? pending : null;
    const timing = x.role === 'assistant' ? chatTimingLabel(x, turn) : '';
    const content = x.role === 'assistant' ? x.content.trimStart() : x.content;
    return `<article class="chat-message ${x.role}"><small>${x.role === 'user' ? esc(currentUser.name) : esc(x.model || 'AI')}</small>${timing ? `<p class="chat-response-timing ${turn && !turn.error ? 'running' : ''}" ${turn ? 'data-live-timing' : ''} title="首字用时包含连接、排队和模型处理；思考用时仅统计收到模型思考信号至正文开始的区间，并非模型内部精确推理耗时。总用时包含回答生成。">${esc(timing)}</p>` : ''}<div ${turn ? `data-live-reply data-length="${x.content.length}"` : ''}>${(x.attachments || []).map(file => `<span class="chat-file-card">▤ ${esc(file.name)}</span>`).join('')}${esc(content)}</div>${turn?.error ? `<p class="chat-reply-status" role="alert">${esc(turn.error)}</p>` : ''}</article>`;
  }).join('') : '<div class="chat-welcome"><span>✦</span><h2>有什么可以帮你？</h2></div>';
  const choices = chatModelChoices();
  const model = choices.find(x => x.id === selectedModel);
  document.getElementById('chatModel').innerHTML = `${esc(model?.label || '小研AI')} <span aria-hidden="true">⌄</span>`;
  document.getElementById('chatModel').setAttribute('aria-disabled', String(aiSending));
  document.getElementById('chatModelOptions').innerHTML = choices.map((x, index) => `<button type="button" role="menuitemradio" aria-checked="${x.id === selectedModel}" onclick="chooseChatModel(${index})" ${aiSending ? 'disabled' : ''}><span><strong>${esc(x.label)}</strong><small>${x.id === 'xiaoyan-auto' ? '自动选择可用免费模型' : '已启用的对话模型'}</small></span><span aria-hidden="true">${x.id === selectedModel ? '✓' : ''}</span></button>`).join('') || '<p>请管理员启用小研AI</p>';
  if (aiSending) document.getElementById('chatModelMenu').open = false;
  updateChatComposer();
  messages.scrollTop = preserveScroll && !atBottom ? scrollTop : messages.scrollHeight;
}
function chatDuration(ms) {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds >= 60) return `${Math.floor(seconds / 60)} 分 ${Math.floor(seconds % 60)} 秒`;
  return `${seconds.toFixed(1).replace(/\.0$/, '')} 秒`;
}
function chatTimingLabel(message, turn) {
  const timing = message.timing || {};
  if (turn) {
    const elapsedMs = (turn.endedAt ?? performance.now()) - turn.startedAt;
    const elapsed = chatDuration(turn.endedAt == null ? Math.floor(elapsedMs / 1000) * 1000 : elapsedMs);
    if (turn.error) return `已中断 · 用时 ${elapsed}`;
    if (message.content) return `${timing.thinkingMs != null ? `已思考 ${chatDuration(timing.thinkingMs)} · ` : ''}正在回答 · 已用时 ${elapsed}`;
    if (turn.phase === 'thinking') return `思考中 · ${chatDuration(Math.floor((performance.now() - turn.thinkingAt) / 1000) * 1000)}`;
    if (turn.phase === 'switching') return `正在切换 · 已用时 ${elapsed}`;
    return `准备回答 · 已用时 ${elapsed}`;
  }
  const labels = [];
  if (timing.thinkingMs != null) labels.push(`已思考 ${chatDuration(timing.thinkingMs)}`);
  else if (timing.firstTokenMs != null) labels.push(`首字 ${chatDuration(timing.firstTokenMs)}`);
  if (timing.totalMs != null) labels.push(`总用时 ${chatDuration(timing.totalMs)}`);
  return labels.join(' · ');
}
function updateChatTiming() {
  if (currentPage !== 'ai' || !aiPendingTurn || aiPendingTurn.chatId !== (selectedChat?.id || null)) return;
  const label = document.querySelector('#messages [data-live-timing]');
  const text = chatTimingLabel(aiPendingTurn.reply, aiPendingTurn);
  if (label && label.textContent !== text) label.textContent = text;
}
function chatModelChoices() {
  const enabled = modelConfigs.filter(x => x.enabled);
  const auto = enabled.find(x => x.id === 'xiaoyan-auto');
  return auto ? [auto] : enabled;
}
function chooseChatModel(index) {
  if (aiSending) return;
  const choice = chatModelChoices()[index];
  if (!choice) return;
  selectedModel = choice.id;
  document.getElementById('chatModelMenu').open = false;
  paintChat();
}
function updateChatComposer() {
  if (currentPage !== 'ai') return;
  document.getElementById('sendButton').disabled = aiSending || aiUploading || !selectedModel || (!aiDraft.trim() && !aiAttachments.length);
  document.getElementById('chatUploadButton').disabled = aiSending || aiUploading;
  document.getElementById('chatFileInput').disabled = aiSending || aiUploading;
  const attachments = document.getElementById('chatAttachments');
  attachments.hidden = !aiAttachments.length && !aiUploading;
  const markup = aiAttachments.map((file, index) => `<div class="chat-file-card"><span>▤ ${esc(file.name)}</span><button type="button" aria-label="移除 ${esc(file.name)}" onclick="removeChatAttachment(${index})" ${aiSending ? 'disabled' : ''}>×</button></div>`).join('') + (aiUploading ? '<div class="chat-file-card">正在读取文件…</div>' : '');
  if (attachments._markup !== markup) { attachments.innerHTML = markup; attachments._markup = markup; }
  const status = document.getElementById('chatStatus');
  const label = aiSending ? '正在回复' : aiUploading ? '正在读取文件' : '';
  if (status.textContent !== label) status.textContent = label;
}
function removeChatAttachment(index) {
  if (aiSending) return;
  aiAttachments.splice(index, 1); updateChatComposer();
}
async function uploadChatDocuments(input) {
  if (aiSending || aiUploading) return;
  const files = [...input.files]; input.value = '';
  if (files.length + aiAttachments.length > 3) return toast('每条消息最多添加 3 个文件');
  const revision = sessionRevision;
  aiUploading = true; updateChatComposer();
  try {
    for (const file of files) {
      if (!file.size || file.size > 8 * 1024 ** 2) throw new Error('文件需大于 0 字节且不超过 8 MB');
      const response = await fetch('/api/chat-documents', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) }, body: file, signal: AbortSignal.timeout(60000) });
      const result = await response.json();
      if (revision !== sessionRevision) return;
      if (!response.ok) throw new Error(result.error || '文件读取失败');
      if (aiAttachments.reduce((sum, attachment) => sum + attachment.text.length, 0) + result.attachment.text.length > 36000) throw new Error('附件文字合计不能超过 36000 字，请拆分发送');
      aiAttachments.push(result.attachment); updateChatComposer();
    }
  } catch (error) { if (revision === sessionRevision) toast(error.message); }
  finally { if (revision === sessionRevision) { aiUploading = false; updateChatComposer(); } }
}
document.addEventListener('click', event => {
  for (const id of ['chatModelMenu', 'chatUploadMenu']) {
    const menu = document.getElementById(id);
    if (menu && !menu.contains(event.target)) menu.open = false;
  }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') for (const id of ['chatModelMenu', 'chatUploadMenu']) {
    const menu = document.getElementById(id);
    if (menu?.open) { menu.open = false; menu.querySelector('summary').focus(); }
  }
});
function selectChatProject(projectId) {
  if (aiSending || aiUploading) return toast('请等待当前处理完成');
  selectedProject = projectId;
  aiPendingTurn = null;
  if (projectId && selectedChat?.project_id !== projectId) selectedChat = null;
  paintChat();
}
function chatProjectDialog(projectId = '') {
  if (aiSending || aiUploading) return toast('请等待当前处理完成');
  const project = chatProjects.find(x => x.id === projectId);
  document.getElementById('modalRoot').innerHTML = `<div class="overlay" onclick="if(event.target===this)closeModal()"><form class="modal" onsubmit="saveChatProject(event,'${projectId}')"><div class="modal-head"><h2>${project ? '重命名项目' : '新建项目'}</h2><button type="button" class="close" onclick="closeModal()">×</button></div><div class="field"><label for="chatProjectName">项目名称</label><input id="chatProjectName" name="name" required maxlength="60" value="${esc(project?.name || '')}" placeholder="例如：水鸟栖息地研究"></div><div class="modal-actions"><button type="button" class="btn" onclick="closeModal()">取消</button><button class="btn primary" type="submit">保存</button></div></form></div>`;
  document.getElementById('chatProjectName').focus();
}
async function saveChatProject(event, projectId) {
  event.preventDefault();
  const revision = sessionRevision;
  const input = { name: new FormData(event.target).get('name') };
  await perform(event.submitter, async () => {
    const result = await api(projectId ? `/chat-projects/${projectId}` : '/chat-projects', projectId ? 'PUT' : 'POST', input);
    if (revision !== sessionRevision) return;
    selectedProject = projectId || result.project.id;
    if (selectedChat?.project_id !== selectedProject) selectedChat = null;
    closeModal(); await loadAI();
  });
}
async function deleteChatProject(projectId) {
  if (aiSending || aiUploading || !confirm('删除此项目？其中的聊天会保留在“全部聊天”中。')) return;
  const revision = sessionRevision;
  await perform(null, async () => {
    await api(`/chat-projects/${projectId}`, 'DELETE', {});
    if (revision !== sessionRevision) return;
    selectedProject = '';
    if (selectedChat?.project_id === projectId) selectedChat.project_id = '';
    await loadAI();
  });
}
async function moveChatProject(projectId) {
  if (!selectedChat || aiSending || aiUploading) return;
  const revision = sessionRevision;
  await perform(null, async () => {
    const result = await api(`/chats/${selectedChat.id}`, 'PATCH', { projectId });
    if (revision !== sessionRevision) return;
    selectedChat = result.chat; selectedProject = projectId; await loadAI();
  });
  paintChat();
}
async function newChat() {
  if (aiSending || aiUploading) { toast('请等待当前处理完成'); return; }
  const revision = sessionRevision;
  await perform(null, async () => { const result = await api('/chats', 'POST', { projectId: selectedProject }); if (revision !== sessionRevision) return; selectedChat = result.chat; aiPendingTurn = null; aiDraft = ''; aiAttachments = []; if (document.getElementById('chatText')) document.getElementById('chatText').value = ''; await loadAI(); });
}
async function openChat(chatId) {
  if (aiSending || aiUploading) { toast('请等待当前处理完成'); return; }
  const revision = sessionRevision;
  await perform(null, async () => { const result = await api(`/chats/${chatId}`); if (revision !== sessionRevision) return; selectedChat = result.chat; aiPendingTurn = null; aiAttachments = []; paintChat(); });
}
async function deleteChat() {
  if (!selectedChat || aiSending || aiUploading || !confirm('确定删除当前私人对话吗？')) return;
  await perform(null, async () => { await api(`/chats/${selectedChat.id}`, 'DELETE', {}); selectedChat = null; aiPendingTurn = null; await loadAI(); });
}
async function streamChatMessage(chatId, configId, text, attachments, turn, revision) {
  const response = await fetch(`/api/chats/${chatId}/messages`, {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', 'X-Chat-Stream-Version': '2' },
    body: JSON.stringify({ configId, text, attachments }), signal: AbortSignal.timeout(105000),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || '小研AI暂时无法回复');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;
  let paintTimer;
  let metadata;
  const paintReply = () => {
    paintTimer = null;
    if (revision !== sessionRevision || currentPage !== 'ai' || aiPendingTurn !== turn || selectedChat?.id !== chatId) return;
    const bubble = document.querySelector('#messages [data-live-reply]');
    const list = document.getElementById('messages');
    if (!bubble || !list) return;
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    if (turn.reply.content) {
      const length = Number(bubble.dataset.length || 0);
      const extra = turn.reply.content.slice(length);
      if (extra) {
        if (!bubble.lastChild) bubble.append(document.createTextNode(''));
        bubble.lastChild.appendData(bubble.lastChild.length ? extra : extra.trimStart());
        bubble.dataset.length = String(turn.reply.content.length);
      }
    }
    updateChatTiming();
    if (atBottom) list.scrollTop = list.scrollHeight;
  };
  const consume = frame => {
    const line = frame.split('\n').find(x => x.startsWith('data:'));
    if (!line) return;
    const event = JSON.parse(line.slice(5).trim());
    if (event.error) throw new Error(event.error);
    if (event.timing) turn.reply.timing = { ...turn.reply.timing, ...event.timing };
    if (event.token) {
      turn.reply.timing ??= { firstTokenMs: Math.round(performance.now() - turn.startedAt) };
      turn.reply.content += event.token;
    }
    if (event.status) {
      turn.phase = event.status;
      if (event.status === 'thinking') turn.thinkingAt = performance.now();
    }
    if (event.token || event.status) paintTimer ??= setTimeout(paintReply, 50);
    if (event.done && event.chat) {
      turn.reply.timing = { totalMs: Math.round(performance.now() - turn.startedAt), ...turn.reply.timing };
      metadata = event.chat; finished = true;
    }
  };
  try {
    while (!finished) {
      const { value, done } = await reader.read();
      if (revision !== sessionRevision) throw new Error('登录状态已改变');
      buffer = (buffer + decoder.decode(value || new Uint8Array(), { stream: !done })).replace(/\r\n/g, '\n');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) { consume(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2); }
      if (done) break;
    }
    if (!finished) throw new Error('回复连接中断；已收到的文字仍显示在当前窗口。');
    return metadata;
  } finally {
    clearTimeout(paintTimer);
    paintReply();
    await reader.cancel().catch(() => {});
  }
}
async function sendMessage(event) {
  event.preventDefault();
  if (aiSending || aiUploading || !selectedModel) return;
  const input = document.getElementById('chatText').value.trim();
  if (!input && !aiAttachments.length) return;
  const attachments = aiAttachments.map(file => ({ ...file }));
  const revision = sessionRevision;
  const configId = selectedModel;
  const turn = { chatId: selectedChat?.id || null, user: { role: 'user', content: input || '请分析附件内容。', attachments }, reply: { role: 'assistant', content: '', model: '小研AI' }, startedAt: performance.now(), phase: 'connecting' };
  aiPendingTurn = turn;
  aiDraft = ''; aiAttachments = [];
  document.getElementById('chatText').value = '';
  aiSending = true; paintChat();
  aiTimingTimer = setInterval(updateChatTiming, 1000);
  try {
    if (!selectedChat) {
      const result = await api('/chats', 'POST', { projectId: selectedProject });
      if (revision !== sessionRevision) return;
      selectedChat = result.chat;
      turn.chatId = selectedChat.id;
      paintChat(true);
    }
    if (configId === 'xiaoyan-auto') {
      const metadata = await streamChatMessage(selectedChat.id, configId, input, attachments, turn, revision);
      if (revision !== sessionRevision) return;
      selectedChat = { ...selectedChat, ...metadata, messages: metadata.messages || [...selectedChat.messages, turn.user, turn.reply] };
    } else {
      const result = await api(`/chats/${selectedChat.id}/messages`, 'POST', { configId, text: input, attachments });
      if (revision !== sessionRevision) return;
      selectedChat = result.chat;
    }
    aiPendingTurn = null;
    const { messages, ...summary } = selectedChat;
    conversations = [summary, ...conversations.filter(chat => chat.id !== summary.id)];
  } catch (error) {
    if (revision !== sessionRevision) return;
    turn.error = error.message;
    turn.endedAt = performance.now();
    if (!aiDraft.trim() && !aiAttachments.length) {
      aiDraft = input; aiAttachments = attachments;
      const composer = document.getElementById('chatText');
      if (composer) composer.value = aiDraft;
    }
    toast(error.message);
  } finally { if (revision === sessionRevision) { clearInterval(aiTimingTimer); aiSending = false; paintChat(true); } }
}


