const toolLinkCatalog = [
  { title: 'PubMed', url: 'https://pubmed.ncbi.nlm.nih.gov/', category: '科研检索', icon: 'PM', color: '#52819d', description: '生命科学文献检索' },
  { title: 'PMC', url: 'https://pmc.ncbi.nlm.nih.gov/', category: '科研检索', icon: 'PMC', color: '#718baf', description: '开放获取全文文献' },
  { title: 'Zotero', url: 'https://www.zotero.org/', category: '文献管理', icon: 'Z', color: '#b65f68', description: '文献收集与引用管理' },
  { title: 'R Project', url: 'https://www.r-project.org/', category: '数据分析', icon: 'R', color: '#6e8fb5', description: '统计计算与绘图工具官网' },
  { title: 'Python', url: 'https://www.python.org/', category: '数据分析', icon: 'Py', color: '#b49660', description: 'Python 官网与开发文档' },
  { title: 'GitHub', url: 'https://github.com/', category: '开发协作', icon: 'GH', color: '#666a7d', description: '代码仓库与项目协作' },
];
const toolWidgetCatalog = [
  { type: 'clock', title: '时钟', icon: '◷', description: '实时显示时间与日期', color: '#7189b2' },
  { type: 'todo', title: '待办清单', icon: '☑', description: '记录计划，完成后勾选', color: '#8875bd' },
  { type: 'note', title: '便签', icon: '▤', description: '随手记下一个想法', color: '#b99967' },
  { type: 'countdown', title: '倒计时', icon: '◴', description: '距离目标日期还有几天', color: '#608f7c' },
];
function toolDesktopWidgets() { return dashboardSettings().toolWidgets || []; }
function toolDesktopCard(widget) {
  const key = `widget-${widget.id}`;
  const menu = `<details class="tool-shortcut-menu"><summary aria-label="${esc(widget.title)}的更多操作">···</summary><div><button type="button" onclick="toolWidgetDialog('${widget.type}','${widget.id}')">编辑</button><button type="button" onclick="moveToolDesktopItem('${key}',-1)">向前移动</button><button type="button" onclick="moveToolDesktopItem('${key}',1)">向后移动</button><button type="button" onclick="removeToolWidget('${widget.id}',this)">从桌面移除</button></div></details>`;
  const attributes = `data-component-id="${key}" data-widget-id="${widget.id}" data-search="${esc([widget.title, widget.category, widget.text, widget.url, ...(widget.items || []).map(item => item.text)].join(' ').toLowerCase())}" data-category="${esc(widget.category)}" style="--tool-color:${widget.color};--tool-widget-span:${widget.size}"`;
  if (widget.type === 'link') return `<article class="card tool-shortcut" ${attributes}><a class="tool-link" href="${esc(toolUrl(widget.url))}" target="_blank" rel="noopener noreferrer" draggable="false" aria-label="${esc(widget.title)}（在新标签页打开）" onkeydown="toolWidgetKey(event,'${key}')"><span class="tool-icon" aria-hidden="true">${esc(widget.icon || Array.from(widget.title).slice(0, 2).join(''))}</span><span class="tool-name">${esc(widget.title)}</span></a><div class="tool-shortcut-actions"><span class="tool-personal-label">个人链接</span>${menu}</div></article>`;
  let body = '';
  if (widget.type === 'clock') body = '<time class="tool-clock-value" data-tool-clock></time><span class="tool-widget-muted" data-tool-date></span>';
  if (widget.type === 'note') body = `<button type="button" class="tool-note-text" onclick="toolWidgetDialog('note','${widget.id}')">${esc(widget.text || '点击写下你的想法…')}</button>`;
  if (widget.type === 'countdown') body = `<div class="tool-countdown-value" data-countdown-date="${widget.date}"></div><span class="tool-widget-muted">${esc(widget.date)}</span>`;
  if (widget.type === 'todo') {
    const remaining = widget.items.filter(item => !item.done).length;
    body = `<div class="tool-todo-items">${widget.items.slice(0, 3).map((item, index) => `<label class="${item.done ? 'done' : ''}"><input type="checkbox" ${item.done ? 'checked' : ''} onchange="toggleToolTodo('${widget.id}',${index},this)"><span>${esc(item.text)}</span></label>`).join('') || '<span class="tool-widget-muted">还没有待办，添加一个小目标</span>'}</div><button type="button" class="tool-widget-footer" onclick="toolWidgetDialog('todo','${widget.id}')">${remaining ? `${remaining} 项待完成` : '全部完成'} · ${widget.items.length > 3 ? '查看全部' : '编辑清单'} →</button>`;
  }
  return `<article class="card tools-widget tools-widget-${widget.type}" ${attributes}><div class="tool-widget-header"><strong>${esc(widget.title)}</strong>${menu}</div><div class="tool-widget-body">${body}</div><button type="button" class="tool-widget-edit" aria-label="编辑${esc(widget.title)}" onclick="toolWidgetDialog('${widget.type}','${widget.id}')">编辑</button></article>`;
}
function toolWidgetKey(event, key) {
  if (event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); moveToolDesktopItem(key, event.key === 'ArrowLeft' ? -1 : 1); }
}
function repaintToolDesktop() {
  if (currentPage !== 'software') return;
  const query = document.querySelector('.local-search')?.value || '';
  const main = document.querySelector('.main'), top = main.scrollTop;
  document.getElementById('content').innerHTML = softwarePage();
  document.querySelector('.local-search').value = query;
  filterRows(query); componentApply(); updateToolClocks();
  main.scrollTop = top;
}
async function saveToolDesktop(widgets, button) {
  if (dashboardSaving) return false;
  const revision = sessionRevision;
  const previousDraft = dashboardDraft ? structuredClone(dashboardDraft) : null;
  dashboardEnsureDraft();
  const previous = toolDesktopWidgets();
  const addedCards = widgets.filter(widget => widget.type !== 'link' && !previous.some(old => old.id === widget.id)).map(widget => `widget-${widget.id}`);
  const valid = new Set([...data.software.map(tool => tool.id), ...widgets.map(widget => `widget-${widget.id}`)]);
  const current = [...document.querySelectorAll('#resourceCards > [data-component-id]')].map(tile => tile.dataset.componentId).filter(key => valid.has(key));
  const order = [...new Set([...addedCards, ...current, ...valid])];
  dashboardDraft.toolWidgets = widgets;
  dashboardDraft.componentOrder ||= {}; dashboardDraft.componentOrder.software ||= {};
  dashboardDraft.componentOrder.software['resources:all'] = order;
  await dashboardSave(button);
  if (revision !== sessionRevision) return false;
  if (dashboardDraft) { dashboardDraft = previousDraft; return false; }
  repaintToolDesktop();
  return true;
}
async function removeToolWidget(id, button) {
  if (!confirm('从你的个人桌面移除此项？')) return;
  await saveToolDesktop(toolDesktopWidgets().filter(widget => widget.id !== id), button);
}
async function toggleToolTodo(id, index, input) {
  if (dashboardSaving) { input.checked = !input.checked; return; }
  const widgets = structuredClone(toolDesktopWidgets());
  const widget = widgets.find(item => item.id === id);
  if (!widget?.items[index]) return;
  widget.items[index].done = input.checked;
  if (!await saveToolDesktop(widgets, null)) input.checked = !input.checked;
}
function toolWidgetDialog(type, id = '') {
  const existing = toolDesktopWidgets().find(widget => widget.id === id);
  const template = toolWidgetCatalog.find(widget => widget.type === type);
  if (!template && type !== 'link') return;
  const widget = existing || { id: crypto.randomUUID(), type, title: template?.title || '', category: type === 'link' ? '常用链接' : '组件', color: template?.color || '#8875bd', size: type === 'link' ? 1 : 2 };
  let fields = `<div class="field full"><label for="desktopTitle">名称</label><input id="desktopTitle" name="title" maxlength="80" required value="${esc(widget.title)}"></div>`;
  if (type === 'link') fields += `<div class="field full"><label for="desktopUrl">链接网址</label><input id="desktopUrl" name="url" type="url" maxlength="2048" required placeholder="https://…" value="${esc(widget.url || '')}"></div><div class="field"><label for="desktopIcon">图标文字 / 表情</label><input id="desktopIcon" name="icon" maxlength="12" value="${esc(widget.icon || '')}" placeholder="如 R、Py、🔬"></div>`;
  if (type === 'note') fields += `<div class="field full"><label for="desktopText">便签内容</label><textarea id="desktopText" name="text" rows="7" maxlength="4000" placeholder="留住一个研究灵感…">${esc(widget.text || '')}</textarea></div>`;
  if (type === 'todo') fields += `<div class="field full"><label for="desktopItems">待办清单（每行一项，最多 40 项）</label><textarea id="desktopItems" name="items" rows="7" maxlength="6440" placeholder="读完一篇文献&#10;整理本周数据">${esc((widget.items || []).map(item => item.text).join('\n'))}</textarea></div>`;
  if (type === 'countdown') fields += `<div class="field full"><label for="desktopDate">目标日期</label><input id="desktopDate" name="date" type="date" required value="${esc(widget.date || '')}"></div>`;
  fields += `<div class="field"><label for="desktopCategory">分类</label><input id="desktopCategory" name="category" maxlength="80" value="${esc(widget.category)}"></div><div class="field"><label for="desktopColor">颜色</label><input id="desktopColor" name="color" type="color" value="${widget.color}"></div>`;
  if (type !== 'link') fields += `<div class="field"><label for="desktopSize">组件宽度</label><select id="desktopSize" name="size"><option value="2" ${widget.size === 2 ? 'selected' : ''}>标准 · 2 格</option><option value="3" ${widget.size === 3 ? 'selected' : ''}>宽版 · 3 格</option></select></div>`;
  document.getElementById('modalRoot').innerHTML = `<div class="overlay" onclick="if(event.target===this)closeModal()"><form class="modal tool-widget-editor" data-widget-id="${widget.id}" data-widget-type="${type}" onsubmit="saveToolWidget(event)"><div class="modal-head"><h2>${existing ? '编辑' : '添加'}${type === 'link' ? '个人链接' : template.title}</h2><button type="button" class="close" onclick="closeModal()">×</button></div><div class="form-grid">${fields}</div><p class="tool-editor-hint">仅保存在你的个人桌面，同一账号的其他设备可同步。</p><div class="modal-actions"><button type="button" class="btn" onclick="closeModal()">取消</button><button type="submit" class="btn primary">保存到桌面</button></div></form></div>`;
  document.getElementById('desktopTitle').focus();
}
async function saveToolWidget(event) {
  event.preventDefault();
  const form = event.target, values = Object.fromEntries(new FormData(form));
  const widgets = structuredClone(toolDesktopWidgets());
  const old = widgets.find(widget => widget.id === form.dataset.widgetId);
  const widget = { ...values, id: form.dataset.widgetId, type: form.dataset.widgetType, size: Number(values.size || 1), title: values.title.trim(), category: values.category.trim() || '组件' };
  if (widget.type === 'link' && !toolUrl(widget.url)) return toast('请填写完整的 HTTP / HTTPS 网址');
  if (widget.type === 'todo') {
    const lines = values.items.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (lines.length > 40 || lines.some(line => line.length > 160)) return toast('最多 40 项，每项不超过 160 个字');
    const remaining = [...(old?.items || [])];
    widget.items = lines.map(text => { const match = remaining.findIndex(item => item.text === text); return match < 0 ? { text, done: false } : remaining.splice(match, 1)[0]; });
  }
  const index = widgets.findIndex(item => item.id === widget.id);
  if (index < 0) widgets.push(widget); else widgets[index] = widget;
  if (widgets.length > 80) return toast('个人桌面最多添加 80 个组件或链接');
  if (await saveToolDesktop(widgets, form.querySelector('[type=submit]'))) closeModal();
}
function openToolLibrary(tab = 'widgets') {
  document.getElementById('modalRoot').innerHTML = `<div class="overlay tool-library-overlay" onclick="if(event.target===this)closeModal()"><section class="modal tool-library" role="dialog" aria-modal="true" aria-labelledby="toolLibraryTitle"><div class="modal-head"><h2 id="toolLibraryTitle">添加到桌面</h2><button type="button" class="close" onclick="closeModal()" aria-label="关闭添加面板">×</button></div><div class="tool-library-tabs"><button type="button" data-library-tab="links" onclick="setToolLibraryTab('links')">链接</button><button type="button" data-library-tab="widgets" onclick="setToolLibraryTab('widgets')">小组件</button></div><button type="button" class="btn primary tool-custom-link" onclick="toolWidgetDialog('link')">＋ 自定义链接</button><label class="tool-library-search"><span class="sr-only">搜索可添加内容</span><input id="toolLibrarySearch" type="search" placeholder="搜索链接或组件" oninput="paintToolLibrary()"></label><div class="tool-library-list" id="toolLibraryList"></div><div class="tool-library-footer"><span>个人组件与链接仅自己可见</span><button type="button" class="subtle-link" onclick="openModal('software')">添加课题组共享软件 →</button></div></section></div>`;
  setToolLibraryTab(tab);
  document.querySelector(`[data-library-tab="${tab}"]`).focus();
}
function setToolLibraryTab(tab) {
  document.querySelectorAll('[data-library-tab]').forEach(button => { const active = button.dataset.libraryTab === tab; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  document.getElementById('toolLibraryList').dataset.tab = tab;
  paintToolLibrary();
}
function paintToolLibrary() {
  const list = document.getElementById('toolLibraryList');
  if (!list) return;
  const query = document.getElementById('toolLibrarySearch').value.trim().toLowerCase();
  const links = list.dataset.tab === 'links';
  const catalog = links ? toolLinkCatalog : toolWidgetCatalog;
  const urls = new Set([...data.software, ...toolDesktopWidgets()].map(widget => toolUrl(widget.url)).filter(Boolean));
  list.innerHTML = catalog.map((item, index) => ({ item, index })).filter(({ item }) => [item.title, item.category, item.description].join(' ').toLowerCase().includes(query)).map(({ item, index }) => {
    const added = links && urls.has(toolUrl(item.url));
    return `<article class="tool-library-card" style="--tool-color:${item.color}"><span class="tool-library-icon" aria-hidden="true">${esc(item.icon)}</span><strong>${esc(item.title)}</strong><p>${esc(item.description)}</p><button type="button" ${added ? 'disabled' : ''} onclick="${links ? `addToolLinkPreset(${index},this)` : `toolWidgetDialog('${item.type}')`}">${added ? '✓ 已添加' : '＋ 添加'}</button></article>`;
  }).join('') || '<p class="tool-library-empty">没有匹配的内容，可通过“自定义链接”添加。</p>';
}
async function addToolLinkPreset(index, button) {
  const preset = toolLinkCatalog[index];
  const widgets = toolDesktopWidgets();
  if (!preset || widgets.length >= 80) return toast('个人桌面最多添加 80 个组件或链接');
  if (await saveToolDesktop([...widgets, { ...preset, id: crypto.randomUUID(), type: 'link', size: 1 }], button)) paintToolLibrary();
}
function updateToolClocks() {
  if (currentPage !== 'software' || document.hidden) return;
  const now = new Date();
  const time = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const date = now.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
  document.querySelectorAll('[data-tool-clock]').forEach(element => { if (element.textContent !== time) element.textContent = time; });
  document.querySelectorAll('[data-tool-date]').forEach(element => { if (element.textContent !== date) element.textContent = date; });
  document.querySelectorAll('[data-countdown-date]').forEach(element => {
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const days = Math.round((Date.parse(`${element.dataset.countdownDate}T00:00:00Z`) - today) / 86400000);
    const label = days === 0 ? '就是今天' : `${days > 0 ? '还有' : '已过'} ${Math.abs(days)} 天`;
    if (element.textContent !== label) element.textContent = label;
  });
}
setInterval(updateToolClocks, 1000);
document.addEventListener('visibilitychange', updateToolClocks);
document.addEventListener('keydown', event => { if (event.key === 'Escape' && document.querySelector('.tool-library')) closeModal(); });
