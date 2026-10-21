let uiResizeState = null;
function uiSizeTargets() {
  return [...document.querySelectorAll('.dashboard-widget')].map(element => [element.dataset.widget, element]).concat([['sidebar', document.querySelector('.sidebar')], ['chat', document.getElementById('groupChatPanel')], ['lifeHero', document.querySelector('.life-hero')]]).filter(([, element]) => element);
}
function uiApplySizes() {
  navigationApply();
  componentApply();
  const sizes = dashboardSettings().dimensions || {};
  for (const key of ['sidebar', 'chat']) {
    const prefix = key === 'sidebar' ? 'left' : 'right';
    document.documentElement.style.setProperty(`--ui-${prefix}-width`, `${sizes[key]?.width || 220}px`);
    document.documentElement.style.setProperty(`--ui-${prefix}-height`, sizes[key] ? `${sizes[key].height}px` : 'calc(100dvh - 48px)');
  }
  for (const [key, element] of uiSizeTargets()) {
    const size = sizes[key];
    element.classList.toggle('ui-sized', Boolean(size));
    if (element.dataset.widget) {
      const columns = getComputedStyle(element.parentElement).gridTemplateColumns.split(' ').length;
      element.style.gridColumn = size ? `span ${Math.min(columns, size.width)}` : '';
      element.style.height = size ? `${size.height}px` : '';
    } else if (key === 'lifeHero') {
      element.style.width = size ? `min(100%, ${size.width}px)` : '';
      element.style.height = size ? `${size.height}px` : '';
    }
    if (!element.querySelector(':scope > .ui-resize-handle')) {
      const edges = ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'];
      for (const edge of edges) {
        const handle = document.createElement('button');
        handle.type = 'button'; handle.className = `ui-resize-handle edge-${edge}`; handle.dataset.resize = key; handle.dataset.edge = edge;
        handle.title = '拖动边缘调整尺寸 · 双击恢复默认 · 方向键微调';
        handle.setAttribute('aria-label', `${key === 'sidebar' ? '目录栏' : key === 'chat' ? '聊天栏' : key === 'lifeHero' ? '照片轮播' : dashboardCatalog[key][0]}：${['n', 's'].includes(edge) ? '调整高度' : edge.length === 1 ? '调整宽度' : '调整宽高'}，双击恢复默认`);
        element.append(handle);
      }
    }
  }
}
function uiSizeValue(key, width, height, element) {
  if (element.dataset.widget) {
    const grid = element.parentElement;
    const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
    const gap = parseFloat(getComputedStyle(grid).columnGap) || 0;
    const unit = (grid.clientWidth + gap) / columns;
    width = Math.max(1, Math.min(columns, Math.round((width + gap) / unit)));
  } else {
    const maxWidth = key === 'lifeHero' ? Math.min(2400, element.parentElement.clientWidth) : Math.min(420, Math.max(160, innerWidth / 3));
    width = Math.max(160, Math.min(maxWidth, Math.round(width)));
  }
  const minHeight = ['sidebar', 'chat'].includes(key) ? 260 : key === 'lifeHero' ? 300 : 120;
  return { width, height: Math.max(minHeight, Math.min(1600, Math.round(height))) };
}
function uiResizeMove(event) {
  const drag = uiResizeState;
  if (!drag || event.pointerId !== drag.pointerId) return;
  event.preventDefault();
  if (!drag.started && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4) return;
  drag.started = true;
  dashboardEnsureDraft();
  const horizontal = drag.edge.includes('e') || drag.edge.includes('w');
  const widthDelta = horizontal ? (event.clientX - drag.x) * (drag.edge.includes('w') ? -1 : 1) : 0;
  const vertical = drag.edge.includes('s') || drag.edge.includes('n');
  const heightDelta = vertical ? (event.clientY - drag.y) * (drag.edge.includes('n') ? -1 : 1) : 0;
  const size = uiSizeValue(drag.key, drag.width + widthDelta, drag.height + heightDelta, drag.element);
  if (!horizontal && drag.original) size.width = drag.original.width;
  if (!vertical) size.height = drag.original?.height || Math.max(120, Math.min(1600, Math.round(drag.height)));
  dashboardDraft.dimensions[drag.key] = size;
  uiApplySizes();
}
function uiResizeEnd(event, cancelled = false) {
  const drag = uiResizeState;
  if (!drag || (event?.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
  uiResizeState = null;
  document.removeEventListener('pointermove', uiResizeMove);
  document.removeEventListener('pointerup', uiResizeEnd);
  document.removeEventListener('pointercancel', uiResizeCancel);
  window.removeEventListener('blur', uiResizeCancel);
  document.body.classList.remove('ui-resizing');
  if (!drag.started) return;
  if (cancelled) {
    if (drag.original) dashboardDraft.dimensions[drag.key] = drag.original;
    else delete dashboardDraft.dimensions[drag.key];
    if (!drag.draftExisted) dashboardDraft = null;
  } else if (!dashboardEditing) dashboardSave(null);
  uiApplySizes();
}
function uiResizeCancel(event) { uiResizeEnd(event, true); }
document.addEventListener('pointerdown', event => {
  const handle = event.target.closest('.ui-resize-handle');
  if (!handle || event.button !== 0 || dashboardSaving || dashboardPointer || uiResizeState) return;
  event.stopPropagation(); event.preventDefault();
  const element = handle.parentElement, rect = element.getBoundingClientRect(), key = handle.dataset.resize;
  uiResizeState = { key, element, edge: handle.dataset.edge, pointerId: event.pointerId, x: event.clientX, y: event.clientY, width: rect.width, height: rect.height, original: dashboardSettings().dimensions?.[key], draftExisted: Boolean(dashboardDraft), started: false };
  handle.setPointerCapture(event.pointerId);
  document.body.classList.add('ui-resizing');
  document.addEventListener('pointermove', uiResizeMove, { passive: false });
  document.addEventListener('pointerup', uiResizeEnd);
  document.addEventListener('pointercancel', uiResizeCancel);
  window.addEventListener('blur', uiResizeCancel);
}, true);
document.addEventListener('dblclick', event => {
  const handle = event.target.closest('.ui-resize-handle');
  if (!handle || dashboardSaving) return;
  event.stopPropagation(); dashboardEnsureDraft();
  delete dashboardDraft.dimensions[handle.dataset.resize];
  uiApplySizes();
  if (!dashboardEditing) dashboardSave(null);
}, true);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && uiResizeState) return uiResizeEnd(null, true);
  const handle = event.target.closest('.ui-resize-handle');
  if (!handle || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || dashboardSaving) return;
  event.preventDefault(); event.stopPropagation(); dashboardEnsureDraft();
  const rect = handle.parentElement.getBoundingClientRect();
  const widthStep = handle.parentElement.dataset.widget ? rect.width / (dashboardDraft.dimensions[handle.dataset.resize]?.width || (handle.parentElement.classList.contains('widget-stat') ? 1 : 2)) : 16;
  dashboardDraft.dimensions[handle.dataset.resize] = uiSizeValue(handle.dataset.resize, rect.width + (event.key === 'ArrowRight' ? widthStep : event.key === 'ArrowLeft' ? -widthStep : 0), rect.height + (event.key === 'ArrowDown' ? 16 : event.key === 'ArrowUp' ? -16 : 0), handle.parentElement);
  uiApplySizes();
  if (!dashboardEditing) dashboardSave(null);
}, true);
window.addEventListener('DOMContentLoaded', () => {
  new MutationObserver(uiApplySizes).observe(document.getElementById('content'), { childList: true });
  uiApplySizes();
});
window.addEventListener('resize', uiApplySizes);
