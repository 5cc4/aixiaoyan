let toolCategory = '';
const toolColors = ['#8875bd', '#538c9c', '#608f7c', '#bc8c65', '#7189b2'];
function toolAppearance(tool) {
  const index = Array.from(tool.title).reduce((sum, char) => sum + char.codePointAt(0), 0) % toolColors.length;
  return {
    color: /^#[a-f0-9]{6}$/i.test(tool.color || '') ? tool.color : toolColors[index],
    icon: tool.icon || Array.from(tool.title.trim()).slice(0, 2).join('').toUpperCase() || '⌘',
  };
}
function toolUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
function softwarePage() {
  const widgets = toolDesktopWidgets();
  const categories = [...new Set([...data.software.map(tool => tool.category || '未分组'), ...widgets.map(widget => widget.category)])].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  if (!categories.includes(toolCategory)) toolCategory = '';
  const cards = data.software.map((tool, index) => {
    const { color, icon } = toolAppearance(tool);
    const url = toolUrl(tool.url);
    const category = tool.category || '未分组';
    const count = (data.files || []).filter(file => file.kind === 'software' && file.record_id === tool.id).length;
    const search = [tool.title, tool.description, category, tool.tags, tool.instructions, tool.url].join(' ').toLowerCase();
    return `<article class="card tool-shortcut" data-component-id="${tool.id}" data-search="${esc(search)}" data-category="${esc(category)}" style="--tool-color:${color}">
      <a class="tool-link" href="${esc(url || '#')}" ${url ? 'target="_blank" rel="noopener noreferrer"' : `onclick="event.preventDefault();openRecordFiles('software',${index})"`} draggable="false" onkeydown="toolShortcutKey(event,${index})" aria-label="${esc(tool.title)} · ${url ? '打开网站（新标签页）' : '查看工具资源'}" title="${esc(tool.description || tool.title)}">
        <span class="tool-icon" aria-hidden="true">${esc(icon)}</span><span class="tool-name">${esc(tool.title)}</span>
      </a>
      <div class="tool-shortcut-actions"><button type="button" class="tool-guide-button" onclick="toolGuideDialog(${index})">${icons.book}<span>使用说明</span></button>
        <details class="tool-shortcut-menu"><summary aria-label="${esc(tool.title)}的更多操作">···</summary><div>
          <button type="button" onclick="recordDialog('software',${index})">查看 / 编辑</button>
          <button type="button" onclick="openRecordFiles('software',${index})">工具资源${count ? ` · ${count}` : ''}</button>
          <button type="button" onclick="moveToolShortcut(${index},-1)">向前移动</button>
          <button type="button" onclick="moveToolShortcut(${index},1)">向后移动</button>
        </div></details>
      </div>
    </article>`;
  }).join('');
  return `<section class="tools-launcher" aria-label="软件工具快捷入口">
    <div class="tools-toolbar"><label class="tools-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4 4"/></svg><span class="sr-only">搜索桌面</span><input class="local-search" type="search" placeholder="搜索链接、组件或工具" oninput="filterRows(this.value)"></label><button type="button" class="btn tools-add-button" onclick="openToolLibrary('links')">＋ 添加链接</button><button type="button" class="btn primary tools-add-button" onclick="openToolLibrary('widgets')">▦ 添加组件</button></div>
    <nav class="tools-tabs" aria-label="工具分类"><button type="button" data-tool-category="" onclick="selectToolCategory(this)" class="${toolCategory ? '' : 'active'}" aria-pressed="${!toolCategory}">全部</button>${categories.map(category => `<button type="button" data-tool-category="${esc(category)}" onclick="selectToolCategory(this)" class="${category === toolCategory ? 'active' : ''}" aria-pressed="${category === toolCategory}">${esc(category)}</button>`).join('')}</nav>
    <div class="grid tools-grid" id="resourceCards">${widgets.map(toolDesktopCard).join('')}${cards}<button type="button" class="tool-add-shortcut" onclick="openToolLibrary('links')"><span aria-hidden="true">＋</span><span>添加到桌面</span></button></div>
    <div class="tools-empty" id="cardsEmpty" style="display:none"><span aria-hidden="true">⌕</span><p>${data.software.length || widgets.length ? '没有找到匹配的内容' : '添加链接和小组件，布置你的研究桌面'}</p><button type="button" class="subtle-link" onclick="${data.software.length || widgets.length ? 'resetToolSearch()' : "openToolLibrary('widgets')"}">${data.software.length || widgets.length ? '显示全部' : '添加第一个组件'}</button></div>
  </section>`;
}
function selectToolCategory(button) {
  toolCategory = button.dataset.toolCategory;
  document.querySelectorAll('[data-tool-category]').forEach(tab => {
    const active = tab.dataset.toolCategory === toolCategory;
    tab.classList.toggle('active', active); tab.setAttribute('aria-pressed', String(active));
  });
  filterRows();
}
function resetToolSearch() {
  document.querySelector('.tools-search input').value = '';
  selectToolCategory(document.querySelector('[data-tool-category=""]'));
}
function toolShortcutKey(event, index) {
  if (event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault(); moveToolShortcut(index, event.key === 'ArrowLeft' ? -1 : 1);
  }
}
async function moveToolShortcut(index, direction) {
  return moveToolDesktopItem(data.software[index]?.id, direction);
}
async function moveToolDesktopItem(id, direction) {
  if (dashboardSaving || componentDrag) return;
  document.querySelectorAll('.tool-shortcut-menu').forEach(menu => menu.open = false);
  const grid = document.getElementById('resourceCards');
  const tiles = [...grid.querySelectorAll('[data-component-id]')];
  const visible = tiles.filter(tile => tile.style.display !== 'none');
  const tile = tiles.find(item => item.dataset.componentId === id);
  const position = visible.indexOf(tile);
  const target = visible[position + direction];
  if (position < 0 || !target) return;
  dashboardEnsureDraft();
  grid.insertBefore(tile, direction < 0 ? target : target.nextSibling);
  dashboardDraft.componentOrder ||= {};
  dashboardDraft.componentOrder.software ||= {};
  dashboardDraft.componentOrder.software['resources:all'] = [...grid.querySelectorAll('[data-component-id]')].map(item => item.dataset.componentId);
  await dashboardSave(null);
  tile.querySelector('.tool-link,button').focus();
}
function toolEditorFields(add) {
  const categories = [...new Set(data.software.map(tool => tool.category).filter(Boolean))];
  return add('工具网址（选填）', 'url', 'https://…', true, 'url') +
    '<p class="tool-editor-hint field full">网页工具填写网址后可直接打开；桌面软件留空，点击图标查看资源。</p>' +
    add('简介', 'description', '简要说明', true) +
    `<div class="field"><label for="toolCategoryInput">分类</label><input id="toolCategoryInput" name="category" list="toolCategoryOptions" maxlength="600" placeholder="例如：数据分析"><datalist id="toolCategoryOptions">${categories.map(category => `<option value="${esc(category)}"></option>`).join('')}</datalist></div>` +
    add('版本', 'release', '1.0') + add('标签', 'tags', 'GIS, R') +
    '<div class="field"><label for="toolIconInput">图标文字 / 表情</label><input id="toolIconInput" name="icon" maxlength="12" placeholder="如 R、Py、🔬"></div>' +
    '<div class="field"><label for="toolColorInput">图标颜色</label><input id="toolColorInput" name="color" type="color" value="#8875bd"></div>' +
    '<div class="field full"><label for="toolInstructions">使用说明（全组可见）</label><textarea id="toolInstructions" name="instructions" maxlength="12000" rows="8" placeholder="工具用途、准备环境、操作步骤、输入输出、常见问题。"></textarea></div>';
}
document.addEventListener('click', event => {
  document.querySelectorAll('.tool-shortcut-menu[open]').forEach(menu => { if (!menu.contains(event.target)) menu.open = false; });
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  document.querySelectorAll('.tool-shortcut-menu[open]').forEach(menu => { menu.open = false; menu.querySelector('summary').focus(); });
});
