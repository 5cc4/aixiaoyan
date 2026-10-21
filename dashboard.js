const dashboardDefaults = {
  labels: {},
  dimensions: {},
  componentOrder: {},
  toolWidgets: [],
  navigation: [['dashboard', 'files', 'literature', 'publications', 'submissions', 'ai', 'software'], ['life', 'members', 'settings']],
  layout: ['welcome', 'insight', 'progress', 'shortcuts', 'literature-stat', 'publications-stat', 'submissions-stat', 'members-stat', 'schedule', 'bookshelf'],
  copy: { eyebrow: 'YOUR RESEARCH, IN FOCUS', greeting: '欢迎回来，{name}', title: '让研究，\n有序发生。', caption: '留一点空间，给下一个好想法。', fontSize: 64, fontWeight: 600, fontFamily: 'system', color: '#303746', noteTitle: '随手笔记', note: '把下一步研究计划记在这里。' },
};
const dashboardCatalog = {
  welcome: ['欢迎与标题', '编辑标语、标题与字体'], insight: ['研究速览', '接下来，先关注什么？'],
  progress: ['投稿进度', '每一次进展，都值得记录'], shortcuts: ['快捷入口', '快速进入常用板块'],
  'literature-stat': ['共享文献', '书目记录与共享文献'], 'publications-stat': ['发表成果', '积累共同的研究足迹'],
  'submissions-stat': ['进行中投稿', '让重要节点清晰可见'], 'members-stat': ['课题组成员', '与同行者一起探索'],
  schedule: ['稿件日程', '重要的事，放在看得见的地方'], bookshelf: ['共享书架', '让知识在课题组中流动'],
  'shared-files': ['共享文件', '只显示当前账号有权查看的文件'], publications: ['最新成果', '记录共同的研究足迹'],
  tools: ['软件工具', '常用研究工具就在手边'], note: ['个人笔记', '在工作台保存自己的备忘文字'],
};
let dashboardPreference = { settings: null, version: 0 };
let dashboardDraft = null;
let dashboardDraftVersion = 0;
let dashboardSaving = false;
let dashboardPointer = null;
let dashboardEditing = false;
function dashboardEnsureDraft() {
  if (dashboardDraft) return;
  dashboardDraft = structuredClone(dashboardSettings());
  dashboardDraft.labels ||= {};
  dashboardDraft.dimensions ||= {};
  dashboardDraftVersion = dashboardPreference.version;
}
function dashboardSettings() { return dashboardDraft || dashboardPreference.settings || dashboardDefaults; }
function dashboardRefresh() {
  if (currentPage !== 'dashboard') return;
  const main = document.querySelector('.main'), top = main.scrollTop;
  document.getElementById('content').innerHTML = dashboard();
  uiApplySizes();
  main.scrollTop = top;
}
function dashboardEdit() {
  if (dashboardSaving) return;
  dashboardEnsureDraft();
  dashboardEditing = true;
  dashboardRefresh();
}
function dashboardCancel() { dashboardDraft = null; dashboardEditing = false; closeModal(); dashboardRefresh(); }
function dashboardRestore() { dashboardDraft = structuredClone(dashboardDefaults); closeModal(); dashboardRefresh(); toast('已恢复默认预览，保存后生效'); }
async function dashboardSave(button) {
  if (!dashboardDraft || dashboardSaving) return;
  const revision = sessionRevision, settings = structuredClone(dashboardDraft), version = dashboardDraftVersion;
  dashboardSaving = true;
  dashboardRefresh();
  await perform(button, async () => {
    const result = await api('/dashboard', 'PUT', { settings, version });
    if (revision !== sessionRevision) return;
    dashboardPreference = result;
    dashboardDraft = null;
    dashboardEditing = false;
    toast('工作台已保存，同一账号的其他设备会同步');
  });
  if (revision === sessionRevision) { dashboardSaving = false; dashboardRefresh(); }
  uiApplySizes();
}
function dashboardMove(key, direction) {
  if (!dashboardDraft || dashboardSaving) return;
  const layout = dashboardDraft.layout, index = layout.indexOf(key), next = index + direction;
  if (index < 0 || next < 0 || next >= layout.length) return;
  [layout[index], layout[next]] = [layout[next], layout[index]];
  dashboardRefresh();
  const moved = document.querySelector(`[data-widget="${key}"]`);
  const button = moved?.querySelector(`.widget-controls > div button:nth-child(${direction < 0 ? 1 : 2})`);
  (button?.disabled ? moved : button)?.focus();
}
function dashboardHide(key) {
  if (!dashboardDraft || dashboardSaving) return;
  if (dashboardDraft.layout.length === 1) return toast('请至少保留一个组件');
  dashboardDraft.layout = dashboardDraft.layout.filter(value => value !== key);
  dashboardRefresh();
}
function dashboardPointerDown(event, key) {
  if (dashboardPointer || uiResizeState || dashboardSaving || event.button !== 0 || event.pointerType === 'touch' || event.target.closest('button,a,input,textarea,select,[contenteditable]')) return;
  const element = event.currentTarget, rect = element.getBoundingClientRect();
  dashboardPointer = { key, element, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, started: false, draftExisted: Boolean(dashboardDraft) };
  document.addEventListener('pointermove', dashboardPointerMove, { passive: false });
  document.addEventListener('pointerup', dashboardPointerFinish);
  document.addEventListener('pointercancel', dashboardPointerFinish);
  document.addEventListener('keydown', dashboardPointerKey);
  window.addEventListener('blur', dashboardPointerFinish);
}
function dashboardPointerMove(event) {
  const drag = dashboardPointer;
  if (!drag || event.pointerId !== drag.pointerId) return;
  drag.x = event.clientX; drag.y = event.clientY;
  if (!drag.started) {
    if (Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 8) return;
    dashboardEnsureDraft();
    drag.layout = [...dashboardDraft.layout];
    drag.started = true;
    const rect = drag.element.getBoundingClientRect();
    drag.preview = drag.element.cloneNode(true);
    drag.preview.classList.add('dashboard-drag-preview');
    drag.preview.removeAttribute('tabindex');
    drag.preview.setAttribute('aria-hidden', 'true');
    drag.preview.setAttribute('inert', '');
    drag.preview.querySelector('.widget-controls')?.remove();
    Object.assign(drag.preview.style, { width: `${rect.width}px`, height: `${rect.height}px`, transformOrigin: `${drag.offsetX}px ${drag.offsetY}px` });
    document.body.append(drag.preview);
    drag.element.classList.add('is-dragging');
    document.body.classList.add('dashboard-drag-active');
    drag.element.setPointerCapture(event.pointerId);
    window.getSelection()?.removeAllRanges();
    dashboardPointerFrame();
  }
  event.preventDefault();
}
function dashboardPointerFrame() {
  const drag = dashboardPointer;
  if (!drag?.started) return;
  drag.preview.style.transform = `translate3d(${drag.x - drag.offsetX}px,${drag.y - drag.offsetY}px,0) scale(1.02)`;
  const main = document.querySelector('.main'), bounds = main.getBoundingClientRect();
  if (drag.y < bounds.top + 100) main.scrollTop -= Math.min(14, Math.max(0, (bounds.top + 100 - drag.y) / 5));
  else if (drag.y > bounds.bottom - 60) main.scrollTop += Math.min(14, (drag.y - bounds.bottom + 60) / 5);
  const target = document.elementFromPoint(drag.x, drag.y)?.closest('.dashboard-widget');
  if (target && target !== drag.element && target.parentElement === drag.element.parentElement) {
    const rect = target.getBoundingClientRect(), source = drag.element.getBoundingClientRect();
    const sameRow = Math.abs(source.top + source.height / 2 - rect.top - rect.height / 2) < Math.min(source.height, rect.height) / 2;
    const after = sameRow ? drag.x > rect.left + rect.width / 2 : drag.y > rect.top + rect.height / 2;
    const layout = dashboardDraft.layout.filter(key => key !== drag.key);
    layout.splice(layout.indexOf(target.dataset.widget) + Number(after), 0, drag.key);
    if (layout.join(',') !== dashboardDraft.layout.join(',')) {
      const grid = drag.element.parentElement, elements = [...grid.children];
      const before = new Map(elements.map(element => [element, element.getBoundingClientRect()]));
      elements.forEach(element => element.getAnimations().forEach(animation => animation.cancel()));
      dashboardDraft.layout = layout;
      grid.classList.toggle('hero-layout', layout.slice(0, 4).join(',') === 'welcome,insight,progress,shortcuts');
      const byKey = new Map(elements.map(element => [element.dataset.widget, element]));
      layout.forEach(key => grid.append(byKey.get(key)));
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
        for (const element of elements) {
          if (element === drag.element) continue;
          const rect = element.getBoundingClientRect(), old = before.get(element);
          if (old.left !== rect.left || old.top !== rect.top) element.animate([{ transform: `translate(${old.left - rect.left}px,${old.top - rect.top}px)` }, { transform: 'none' }], { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' });
        }
      }
    }
  }
  drag.frame = requestAnimationFrame(dashboardPointerFrame);
}
function dashboardPointerKey(event) {
  if (event.key === 'Escape') { event.preventDefault(); dashboardPointerFinish(null, true); }
}
function dashboardPointerFinish(event, cancelled = false) {
  const drag = dashboardPointer;
  if (!drag || (event?.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
  dashboardPointer = null;
  document.removeEventListener('pointermove', dashboardPointerMove);
  document.removeEventListener('pointerup', dashboardPointerFinish);
  document.removeEventListener('pointercancel', dashboardPointerFinish);
  document.removeEventListener('keydown', dashboardPointerKey);
  window.removeEventListener('blur', dashboardPointerFinish);
  if (!drag.started) return;
  cancelAnimationFrame(drag.frame);
  drag.preview.remove();
  drag.element.classList.remove('is-dragging');
  document.body.classList.remove('dashboard-drag-active');
  if (drag.element.hasPointerCapture(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId);
  const suppressClick = click => { click.preventDefault(); click.stopImmediatePropagation(); };
  document.addEventListener('click', suppressClick, true);
  setTimeout(() => document.removeEventListener('click', suppressClick, true), 0);
  if (cancelled || event?.type === 'pointercancel' || event?.type === 'blur') dashboardDraft.layout = drag.layout;
  const changed = drag.layout.join(',') !== dashboardDraft.layout.join(',');
  if (!changed && !drag.draftExisted) dashboardDraft = null;
  if (changed && !dashboardEditing) dashboardSave();
  else dashboardRefresh();
}
function dashboardAddDialog() {
  if (!dashboardDraft || dashboardSaving) return;
  document.getElementById('modalRoot').innerHTML = `<div class="overlay" onclick="if(event.target===this)closeModal()"><section class="modal dashboard-modal" role="dialog" aria-modal="true" aria-labelledby="widgetPickerTitle"><div class="modal-head"><h2 id="widgetPickerTitle">添加工作台组件</h2><button class="close" aria-label="关闭" onclick="closeModal()">×</button></div><p>隐藏的组件可以在这里重新添加。</p><div class="widget-picker">${Object.entries(dashboardCatalog).map(([key, [name, description]]) => `<button class="widget-option" ${dashboardDraft.layout.includes(key) ? 'disabled' : ''} onclick="dashboardAdd('${key}')"><strong>${name}<span>${dashboardDraft.layout.includes(key) ? '已添加' : '＋'}</span></strong><small>${description}</small></button>`).join('')}</div></section></div>`;
}
function dashboardAdd(key) {
  if (!dashboardDraft || dashboardSaving || !dashboardCatalog[key] || dashboardDraft.layout.includes(key)) return;
  dashboardDraft.layout.push(key);
  closeModal();
  dashboardRefresh();
  toast('已添加到工作台底部，可继续移动位置');
}
function dashboardCopyDialog(focusName = 'title') {
  if (dashboardSaving || dashboardPointer?.started) return;
  dashboardEnsureDraft();
  const copy = dashboardDraft.copy;
  const input = (label, name, max) => `<div class="field full"><label for="dashboard-${name}">${label}</label><input id="dashboard-${name}" name="${name}" maxlength="${max}" value="${esc(copy[name])}"></div>`;
  document.getElementById('modalRoot').innerHTML = `<div class="overlay" onclick="if(event.target===this)closeModal()"><form class="modal dashboard-modal" onsubmit="dashboardCopyApply(event)" role="dialog" aria-modal="true" aria-labelledby="dashboardCopyTitle"><div class="modal-head"><h2 id="dashboardCopyTitle">编辑工作台文字</h2><button type="button" class="close" aria-label="关闭" onclick="closeModal()">×</button></div><div class="form-grid">${input('顶部标语（可留空）', 'eyebrow', 100)}${input('欢迎语（{name} 自动替换为姓名）', 'greeting', 100)}<div class="field full"><label for="dashboard-title">主标题（回车换行）</label><textarea id="dashboard-title" name="title" maxlength="120" required>${esc(copy.title)}</textarea></div>${input('标题下方说明（可留空）', 'caption', 300)}<div class="field"><label for="dashboard-fontFamily">标题字体</label><select id="dashboard-fontFamily" name="fontFamily"><option value="system" ${copy.fontFamily === 'system' ? 'selected' : ''}>简洁黑体</option><option value="serif" ${copy.fontFamily === 'serif' ? 'selected' : ''}>学术宋体</option></select></div><div class="field"><label for="dashboard-fontWeight">标题字重</label><select id="dashboard-fontWeight" name="fontWeight">${[[400, '常规'], [500, '适中'], [600, '加粗'], [700, '醒目']].map(([value, label]) => `<option value="${value}" ${copy.fontWeight === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div><div class="field"><label for="dashboard-fontSize">标题字号（36–80）</label><input id="dashboard-fontSize" name="fontSize" type="number" min="36" max="80" step="1" required value="${copy.fontSize}"></div><div class="field"><label for="dashboard-color">标题颜色</label><input id="dashboard-color" name="color" type="color" value="${copy.color}"></div>${dashboardDraft.layout.includes('note') ? `${input('个人笔记标题', 'noteTitle', 80)}<div class="field full"><label for="dashboard-note">个人笔记内容</label><textarea id="dashboard-note" name="note" maxlength="2000">${esc(copy.note)}</textarea></div>` : ''}</div><div class="modal-actions"><button type="button" class="btn" onclick="closeModal()">取消</button><button class="btn primary" type="submit">应用到预览</button></div></form></div>`;
  document.querySelector('.dashboard-modal [type=submit]').textContent = dashboardEditing ? '应用到预览' : '保存修改';
  document.getElementById(`dashboard-${focusName}`)?.focus();
}
function dashboardCopyApply(event) {
  event.preventDefault();
  if (!dashboardDraft || dashboardSaving) return;
  const copy = Object.fromEntries(new FormData(event.target));
  copy.fontSize = Number(copy.fontSize);
  copy.fontWeight = Number(copy.fontWeight);
  dashboardDraft.copy = { ...dashboardDraft.copy, ...copy };
  closeModal(true);
  dashboardRefresh();
  if (dashboardEditing) toast('文字已应用到预览，点击保存后生效');
  else dashboardSave();
}

function dashboardWidgetEdit(event, key) {
  if (dashboardSaving || dashboardPointer?.started || event.target.closest('button,a,input,textarea,select')) return;
  event.stopPropagation();
  dashboardEnsureDraft();
  if (key === 'welcome' || key === 'note') return dashboardCopyDialog(key === 'note' ? 'note' : event.target.closest('[data-dashboard-copy]')?.dataset.dashboardCopy || 'title');
  const [title, subtitle] = dashboardCatalog[key];
  const label = dashboardDraft.labels[key] || { title, subtitle };
  document.getElementById('modalRoot').innerHTML = `<div class="overlay" onclick="if(event.target===this)closeModal()"><form class="modal dashboard-modal" onsubmit="dashboardLabelApply(event,'${key}')" role="dialog" aria-modal="true" aria-labelledby="widgetEditTitle"><div class="modal-head"><h2 id="widgetEditTitle">编辑组件文字</h2><button type="button" class="close" aria-label="关闭" onclick="closeModal()">×</button></div><p>编辑组件标题与说明。数量、日期和研究记录会随实际资料更新。</p><div class="form-grid"><div class="field full"><label for="widgetTitle">组件标题</label><input id="widgetTitle" name="title" required maxlength="80" value="${esc(label.title)}"></div><div class="field full"><label for="widgetSubtitle">组件说明</label><textarea id="widgetSubtitle" name="subtitle" maxlength="300">${esc(label.subtitle)}</textarea></div></div><div class="modal-actions"><button type="button" class="btn" onclick="closeModal()">取消</button><button type="submit" class="btn primary">${dashboardEditing ? '应用到预览' : '保存修改'}</button></div></form></div>`;
  document.getElementById('widgetTitle').focus();
}
function dashboardLabelApply(event, key) {
  event.preventDefault();
  if (!dashboardDraft || dashboardSaving) return;
  dashboardDraft.labels[key] = Object.fromEntries(new FormData(event.target));
  closeModal(true);
  dashboardRefresh();
  if (!dashboardEditing) dashboardSave();
}

function dashboard() {
  const { layout, copy, labels = {} } = dashboardSettings(), editing = dashboardEditing;
  const titleFor = key => esc(labels[key]?.title ?? dashboardCatalog[key][0]);
  const subtitleFor = key => esc(labels[key]?.subtitle ?? dashboardCatalog[key][1]);
  const heroLayout = layout.slice(0, 4).join(',') === 'welcome,insight,progress,shortcuts';
  const active = data.submissions.filter(x => !['published', 'rejected'].includes(x.status));
  const progressed = data.submissions.filter(x => ['accepted', 'published'].includes(x.status)).length;
  const progress = data.submissions.length ? Math.round(progressed / data.submissions.length * 100) : 0;
  const reminders = active.filter(x => x.deadline).sort((a, b) => a.deadline.localeCompare(b.deadline));
  const literatureCount = data.literature.length + (data.files || []).filter(file => file.section === 'literature').length;
  const dateLabel = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
  const shortcuts = [['literature', '文献资料', icons.book], ['submissions', '投稿追踪', icons.check], ['publications', '发表成果', icons.file], ['members', '课题成员', icons.members]];
  const title = esc(copy.title.endsWith('。') ? copy.title.slice(0, -1) : copy.title).replace(/\n/g, '<br>') + (copy.title.endsWith('。') ? '<span>。</span>' : '');
  const section = (key, page, contents) => `<section class="card section-card"><div class="section-head"><div><h2>${titleFor(key)}</h2><p>${subtitleFor(key)}</p></div><button class="subtle-link" onclick="navigate('${page}')">查看全部 ↗</button></div>${contents}</section>`;
  const rows = (items, page, icon, meta) => items.slice(0, 3).map(x => `<div class="resource-row"><div class="file-icon">${icon}</div><div><strong>${esc(x.title || x.name)}</strong><small>${esc(meta(x))}</small></div><button class="download" aria-label="打开${titles[page]}" onclick="navigate('${page}')">${icons.book}</button></div>`).join('') || '<div class="empty">暂时没有记录</div>';
  const widgets = {
    welcome: `<section class="welcome-panel"><div class="welcome-greeting"><p class="welcome-label" data-dashboard-copy="greeting">${esc(copy.greeting.replaceAll('{name}', currentUser?.name || '课题组成员'))}</p><time class="welcome-date">${dateLabel}</time></div><h1 data-dashboard-copy="title" style="--welcome-size:${copy.fontSize}px;font-weight:${copy.fontWeight};color:${copy.color};${copy.fontFamily === 'serif' ? "font-family:'Noto Serif SC','Songti SC','SimSun',serif;letter-spacing:-.03em" : ''}">${title}</h1><p class="welcome-caption" data-dashboard-copy="caption">${esc(copy.caption)}</p></section>`,
    progress: `<section class="research-progress"><div class="progress-heading"><div><span class="progress-widget-title">${titleFor('progress')}</span><span>${subtitleFor('progress')}</span><strong>${active.length} 篇稿件正在推进</strong></div><button class="progress-action" onclick="openModal('submissions')" aria-label="新建投稿">${icons.plus}</button></div><div class="progress-track" role="progressbar" aria-label="已接收或发表的投稿比例" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100"><div style="width:${progress}%"></div></div><div class="progress-caption"><span>投稿记录中已接收 / 已发表</span><span>${progressed} / ${data.submissions.length}</span></div></section>`,
    shortcuts: `<section class="dashboard-shortcuts"><div class="widget-caption"><strong>${titleFor('shortcuts')}</strong><small>${subtitleFor('shortcuts')}</small></div><div class="quick-dock" aria-label="快捷入口">${shortcuts.map(([page, label, icon]) => `<button onclick="navigate('${page}')"><span>${icon}</span>${label}</button>`).join('')}</div></section>`,
    insight: `<section class="insight-panel" aria-label="研究速览"><div class="insight-badge"><span>✦</span> ${titleFor('insight')}</div><div class="insight-question">${subtitleFor('insight')}</div><div class="insight-timestamp">根据当前工作台记录</div><div class="insight-answer"><span class="answer-label">为你整理好了</span><strong>${reminders.length ? `有 ${reminders.length} 篇稿件设置了截止日期。` : '暂时没有设置截止日期的稿件。'}</strong><p>${reminders.length ? `最近截止：${esc(reminders[0].deadline)}<br>${esc(reminders[0].title)}` : '可以整理近期文献，或记录新的投稿进展。'}</p></div><div class="insight-metrics"><button onclick="navigate('submissions')"><span>进行中</span><strong>${active.length}<small>篇投稿</small></strong></button><button onclick="navigate('literature')"><span>资料库</span><strong>${literatureCount}<small>篇文献</small></strong></button></div><button class="insight-cta" onclick="navigate('submissions')"><span>查看投稿与截止日期</span><span aria-hidden="true">↗</span></button></section>`,
    'literature-stat': stat(titleFor('literature-stat'), literatureCount + ' 篇', subtitleFor('literature-stat'), icons.book),
    'publications-stat': stat(titleFor('publications-stat'), data.publications.length + ' 篇', subtitleFor('publications-stat'), icons.file),
    'submissions-stat': stat(titleFor('submissions-stat'), active.length + ' 篇', subtitleFor('submissions-stat'), icons.check),
    'members-stat': stat(titleFor('members-stat'), data.members.length + ' 位', subtitleFor('members-stat'), icons.members),
    schedule: section('schedule', 'submissions', reminders.slice(0, 3).map(x => `<div class="task"><div class="task-date"><b>${esc(x.deadline.slice(8, 10))}</b><small>${esc(x.deadline.slice(5, 7))}月</small></div><div class="task-info"><strong>${esc(x.title)}</strong><small>${esc(x.journal)} · ${esc(x.author)}</small></div><span class="tag ${statusClass(x.status)}">${statusLabel(x.status)}</span></div>`).join('') || '<div class="empty">暂无设置截止日期的投稿</div>'),
    bookshelf: section('bookshelf', 'literature', rows(data.literature, 'literature', 'PDF', x => `${x.journal} · ${x.year}`)),
    'shared-files': section('shared-files', 'files', rows((data.files || []).filter(x => x.section === 'shared' && x.kind !== 'life'), 'files', icons.file, x => x.name)),
    publications: section('publications', 'publications', rows(data.publications, 'publications', icons.file, x => `${x.journal} · ${x.year}`)),
    tools: section('tools', 'software', rows(data.software, 'software', icons.file, x => x.category || '研究工具')),
    note: `<section class="card section-card"><div class="section-head"><div><h2>${esc(copy.noteTitle || '个人笔记')}</h2><p>仅本人可见</p></div>${editing ? '<button class="subtle-link" onclick="dashboardCopyDialog()">编辑笔记 ↗</button>' : ''}</div><p class="dashboard-note">${esc(copy.note)}</p></section>`,
  };
  const disabled = dashboardSaving ? 'disabled' : '';
  const controls = dashboardDraft && !dashboardSaving ? '<div class="dashboard-actions dashboard-entry"><button class="btn" onclick="dashboardSave(this)">重试保存</button><button class="btn" onclick="dashboardCancel()">取消调整</button></div>' : '';
  return `${controls}<div class="workspace-intro"><span class="dashboard-editable" title="双击编辑标语" tabindex="0" ondblclick="dashboardCopyDialog('eyebrow')" onkeydown="if(event.key==='Enter')dashboardCopyDialog('eyebrow')">${esc(copy.eyebrow)}</span></div><div class="dashboard-widgets ${heroLayout ? 'hero-layout' : ''} ${editing ? 'is-editing' : ''}">${layout.map((key, index) => `<div class="dashboard-widget widget-${key.endsWith('-stat') ? 'stat' : key}" data-widget="${key}" draggable="false" tabindex="0" role="group" aria-label="${dashboardCatalog[key][0]}，双击或按回车编辑文字" onpointerdown="dashboardPointerDown(event,'${key}')" ondblclick="dashboardWidgetEdit(event,'${key}')" onkeydown="if(event.target===this&&event.key==='Enter'){event.preventDefault();dashboardWidgetEdit(event,'${key}')}" title="拖动调整位置，双击编辑文字">${editing ? `<div class="widget-controls"><div><button ${index === 0 || dashboardSaving ? 'disabled' : ''} onclick="dashboardMove('${key}',-1)" aria-label="上移${dashboardCatalog[key][0]}">↑</button><button ${index === layout.length - 1 || dashboardSaving ? 'disabled' : ''} onclick="dashboardMove('${key}',1)" aria-label="下移${dashboardCatalog[key][0]}">↓</button><button ${disabled} onclick="dashboardHide('${key}')" aria-label="隐藏${dashboardCatalog[key][0]}">×</button></div></div>` : ''}${widgets[key]}</div>`).join('')}</div>`;
}
