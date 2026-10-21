let navigationDrag = null;
let navigationSuppressUntil = 0;
const navigationNodes = new Map([...document.querySelectorAll('.sidebar .nav button[data-page]')].map(button => [button.dataset.page, button]));
function navigationGroups() { return [...document.querySelectorAll('.sidebar > .nav')]; }
function navigationRead() { return navigationGroups().map(nav => [...nav.querySelectorAll('button[data-page]')].map(button => button.dataset.page)); }
function navigationApply() {
  if (navigationDrag) return;
  const order = dashboardSettings().navigation || dashboardDefaults.navigation;
  navigationGroups().forEach((nav, index) => order[index].forEach(key => {
    const button = navigationNodes.get(key);
    button.title = '拖动调整导航顺序 · Alt+↑/↓ 微调';
    button.draggable = false;
    nav.append(button);
  }));
}
function navigationFrame() {
  const drag = navigationDrag;
  if (!drag?.started) return;
  drag.preview.style.transform = `translate3d(${drag.lastX - drag.offsetX}px,${drag.lastY - drag.offsetY}px,0)`;
  const sidebar = document.querySelector('.sidebar'), rect = sidebar.getBoundingClientRect();
  if (drag.lastY < rect.top + 60) sidebar.scrollTop -= 8;
  if (drag.lastY > rect.bottom - 60) sidebar.scrollTop += 8;
  const hit = document.elementFromPoint(drag.lastX, drag.lastY);
  const target = hit?.closest('.sidebar .nav button[data-page]');
  const nav = hit?.closest('.sidebar > .nav');
  if (target && target !== drag.button) {
    const bounds = target.getBoundingClientRect();
    target.parentElement.insertBefore(drag.button, drag.lastY < bounds.top + bounds.height / 2 ? target : target.nextSibling);
  } else if (nav && !nav.querySelector('button[data-page]')) nav.append(drag.button);
  drag.frame = requestAnimationFrame(navigationFrame);
}
function navigationMove(event) {
  const drag = navigationDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  drag.lastX = event.clientX; drag.lastY = event.clientY;
  if (!drag.started) {
    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 7) return;
    drag.started = true;
    dashboardEnsureDraft();
    drag.preview = document.createElement('nav');
    drag.preview.className = 'nav navigation-drag-preview';
    drag.preview.setAttribute('aria-hidden', 'true'); drag.preview.inert = true;
    drag.preview.style.width = drag.width + 'px';
    drag.preview.append(drag.button.cloneNode(true)); document.body.append(drag.preview);
    drag.button.classList.add('navigation-dragging');
    document.body.classList.add('navigation-sorting');
    navigationFrame();
  }
  event.preventDefault();
}
function navigationEnd(event, cancelled = false) {
  const drag = navigationDrag;
  if (!drag || (event?.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
  navigationDrag = null;
  document.removeEventListener('pointermove', navigationMove);
  document.removeEventListener('pointerup', navigationEnd);
  document.removeEventListener('pointercancel', navigationCancel);
  window.removeEventListener('blur', navigationCancel);
  if (!drag.started) return;
  cancelAnimationFrame(drag.frame); drag.preview.remove(); drag.button.classList.remove('navigation-dragging');
  document.body.classList.remove('navigation-sorting');
  navigationSuppressUntil = Date.now() + 300;
  const order = navigationRead();
  if (cancelled || JSON.stringify(order) === JSON.stringify(drag.before)) {
    if (!drag.draftExisted) dashboardDraft = null;
    navigationGroups().forEach((nav, index) => drag.before[index].forEach(key => nav.append(navigationNodes.get(key))));
  } else {
    dashboardDraft.navigation = order;
    if (!dashboardEditing) dashboardSave(null);
  }
}
function navigationCancel(event) { navigationEnd(event, true); }
document.addEventListener('pointerdown', event => {
  const button = event.target.closest('.sidebar .nav button[data-page]');
  if (!button || event.button !== 0 || dashboardSaving || uiResizeState || dashboardPointer || navigationDrag) return;
  const rect = button.getBoundingClientRect();
  navigationDrag = { button, pointerId: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top, width: rect.width, before: navigationRead(), draftExisted: Boolean(dashboardDraft), started: false };
  button.setPointerCapture(event.pointerId);
  document.addEventListener('pointermove', navigationMove, { passive: false });
  document.addEventListener('pointerup', navigationEnd);
  document.addEventListener('pointercancel', navigationCancel);
  window.addEventListener('blur', navigationCancel);
});
document.addEventListener('click', event => {
  if (Date.now() < navigationSuppressUntil && event.target.closest('.sidebar .nav button')) { event.preventDefault(); event.stopPropagation(); }
}, true);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && navigationDrag) return navigationEnd(null, true);
  const button = event.target.closest('.sidebar .nav button[data-page]');
  if (!button || !event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key) || dashboardSaving) return;
  const buttons = navigationRead().flat(), index = buttons.indexOf(button.dataset.page), next = index + (event.key === 'ArrowUp' ? -1 : 1);
  if (next < 0 || next >= buttons.length) return;
  event.preventDefault(); dashboardEnsureDraft();
  const target = navigationNodes.get(buttons[next]);
  target.parentElement.insertBefore(button, next < index ? target : target.nextSibling);
  dashboardDraft.navigation = navigationRead();
  if (!dashboardEditing) dashboardSave(null);
  button.focus();
});
