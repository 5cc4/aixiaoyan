let componentDrag = null;
let componentSuppressUntil = 0;
function componentGroups() {
  const content = document.getElementById('content');
  if (currentPage === 'dashboard' || currentPage === 'ai' || !currentUser) return [];
  const parents = new Map();
  for (const element of content.querySelectorAll('.card,.notice,.page-tools,.file-overview,.life-hero,.literature-tabs,.grid,.ai-layout,.settings-stack,.page-title')) {
    const parent = element.parentElement;
    if (parent !== content && !parent.matches('.grid,.ai-layout,.settings-stack')) continue;
    if (!parents.has(parent)) parents.set(parent, []);
    parents.get(parent).push(element);
  }
  return [...parents].map(([parent, elements], index) => {
    const context = currentPage === 'files' ? fileContext?.id || 'all' : currentPage === 'literature' ? literatureTab : 'all';
    const group = parent === content ? 'page' : parent.id === 'resourceCards' ? `resources:${context}` : `group:${index}`;
    elements.forEach((element, position) => {
      if (!element.dataset.sortKey) {
        const type = element.className.replace(/\bactive\b/g, '').trim().split(/\s+/).join('-');
        element.dataset.sortKey = element.dataset.componentId || element.id || `${type}-${position}`;
      }
      element.classList.add('component-sortable');
      element.querySelectorAll('img').forEach(image => image.draggable = false);
    });
    return { parent, elements, group };
  });
}
function componentApply() {
  if (componentDrag) return;
  const settings = dashboardSettings().componentOrder?.[currentPage] || {};
  for (const { parent, elements, group } of componentGroups()) {
    const order = settings[group] || [];
    const rank = key => { const index = order.indexOf(key); return index < 0 ? order.length : index; };
    const sorted = [...elements].sort((a,b) => rank(a.dataset.sortKey) - rank(b.dataset.sortKey));
    if (sorted.some((element, index) => element !== elements[index])) {
      const slots = elements.map(element => { const slot = document.createComment('component'); element.replaceWith(slot); return slot; });
      slots.forEach((slot, index) => slot.replaceWith(sorted[index]));
    }
    if (parent.classList.contains('ai-layout')) parent.style.gridTemplateColumns = innerWidth > 1000 ? parent.firstElementChild.classList.contains('chat-sidebar') ? '190px minmax(0,1fr)' : 'minmax(0,1fr) 190px' : '';
  }
}
function componentFrame() {
  const drag = componentDrag;
  if (!drag?.started) return;
  drag.preview.style.transform = `translate3d(${drag.lastX-drag.offsetX}px,${drag.lastY-drag.offsetY}px,0)`;
  const main = document.querySelector('.main'), bounds = main.getBoundingClientRect();
  if (drag.lastY < bounds.top + 80) main.scrollTop -= 8;
  if (drag.lastY > bounds.bottom - 50) main.scrollTop += 8;
  const target = document.elementFromPoint(drag.lastX, drag.lastY)?.closest('.component-sortable');
  if (target && target !== drag.element && target.parentElement === drag.parent) {
    const rect = target.getBoundingClientRect(), own = drag.element.getBoundingClientRect();
    const before = Math.abs(rect.top-own.top) < rect.height / 2 ? drag.lastX < rect.left+rect.width/2 : drag.lastY < rect.top+rect.height/2;
    drag.parent.insertBefore(drag.element, before ? target : target.nextSibling);
  }
  drag.frame = requestAnimationFrame(componentFrame);
}
function componentMove(event) {
  const drag = componentDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;
  drag.lastX = event.clientX; drag.lastY = event.clientY;
  if (!drag.started) {
    if (Math.hypot(event.clientX-drag.x,event.clientY-drag.y) < 8) return;
    drag.started = true; dashboardEnsureDraft();
    drag.preview = drag.element.cloneNode(true); drag.preview.removeAttribute('id');
    drag.preview.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
    drag.preview.querySelectorAll('.ui-resize-handle').forEach(element => element.remove());
    drag.preview.classList.add('component-drag-preview'); drag.preview.inert = true; drag.preview.setAttribute('aria-hidden','true');
    drag.preview.style.width = drag.width+'px'; drag.preview.style.height = drag.height+'px';
    document.body.append(drag.preview); drag.element.classList.add('component-dragging'); document.body.classList.add('component-sorting');
    getSelection()?.removeAllRanges(); componentFrame();
  }
  event.preventDefault();
}
function componentEnd(event, cancelled = false) {
  const drag = componentDrag;
  if (!drag || (event?.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
  componentDrag = null;
  document.removeEventListener('pointermove',componentMove); document.removeEventListener('pointerup',componentEnd);
  document.removeEventListener('pointercancel',componentCancel); window.removeEventListener('blur',componentCancel);
  if (!drag.started) return;
  cancelAnimationFrame(drag.frame); drag.preview.remove(); drag.element.classList.remove('component-dragging'); document.body.classList.remove('component-sorting');
  componentSuppressUntil = Date.now()+300;
  const elements = [...drag.parent.children].filter(element => element.classList.contains('component-sortable'));
  if (cancelled || elements.every((element,index) => element === drag.before[index])) {
    drag.childrenBefore.forEach(element => drag.parent.append(element));
    if (!drag.draftExisted) dashboardDraft = null;
  } else {
    dashboardDraft.componentOrder ||= {};
    dashboardDraft.componentOrder[drag.page] ||= {};
    dashboardDraft.componentOrder[drag.page][drag.group] = elements.map(element => element.dataset.sortKey);
    if (!dashboardEditing) dashboardSave(null);
  }
  componentApply();
}
function componentCancel(event) { componentEnd(event,true); }
document.addEventListener('pointerdown', event => {
  const element = event.target.closest('#content .component-sortable');
  const toolLink = currentPage === 'software' ? event.target.closest('.tool-link') : null;
  if (!element || event.button !== 0 || event.pointerType === 'touch' || (!toolLink && event.target.closest('button,a,input,textarea,select,summary,[contenteditable]')) || dashboardSaving || dashboardPointer || uiResizeState || navigationDrag || componentDrag) return;
  const group = componentGroups().find(group => group.parent === element.parentElement);
  if (!group || group.elements.length < 2) return;
  const rect = element.getBoundingClientRect();
  componentDrag = { element, parent: group.parent, group: group.group, page: currentPage, before: group.elements, childrenBefore:[...group.parent.children], pointerId: event.pointerId, x:event.clientX,y:event.clientY,lastX:event.clientX,lastY:event.clientY,offsetX:event.clientX-rect.left,offsetY:event.clientY-rect.top,width:rect.width,height:rect.height,draftExisted:Boolean(dashboardDraft),started:false };
  (toolLink || element).setPointerCapture(event.pointerId);
  document.addEventListener('pointermove',componentMove,{passive:false}); document.addEventListener('pointerup',componentEnd);
  document.addEventListener('pointercancel',componentCancel); window.addEventListener('blur',componentCancel);
});
document.addEventListener('click', event => { if (Date.now()<componentSuppressUntil && event.target.closest('#content .component-sortable')) {event.preventDefault();event.stopPropagation();} },true);
document.addEventListener('keydown', event => { if (event.key==='Escape' && componentDrag) componentEnd(null,true); });
window.addEventListener('DOMContentLoaded', () => {new MutationObserver(componentApply).observe(document.getElementById('content'),{childList:true,subtree:true});componentApply();});
window.addEventListener('resize',componentApply);
