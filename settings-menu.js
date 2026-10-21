let settingsSelection = 'all';
function settingsModules() {
  return [{ key:'all', label:'全部设置' }, { key:'account', label:'个人账号与资料' }, ...(currentUser?.role === 'admin' ? [{key:'gateway',label:'小研AI'},{key:'mailbox',label:'投稿邮箱'}] : []), {key:'models',label:'AI 模型配置'}, ...(currentUser?.role === 'admin' ? [{key:'members',label:'成员权限'}] : [])];
}
function closeSettingsMenu(focus = false) {
  document.getElementById('settingsQuickMenu')?.remove();
  const button = document.getElementById('profileSettingsToggle');
  button.setAttribute('aria-expanded','false');
  if (focus) button.focus();
}
function toggleSettingsMenu() {
  if (!currentUser) return;
  if (document.getElementById('settingsQuickMenu')) return closeSettingsMenu(true);
  const button = document.getElementById('profileSettingsToggle');
  const menu = document.createElement('div');
  menu.id = 'settingsQuickMenu'; menu.className = 'settings-quick-menu'; menu.setAttribute('role','menu'); menu.setAttribute('aria-label','设置模块');
  menu.innerHTML = `<strong>设置模块</strong>${settingsModules().map(item=>`<button type="button" role="menuitem" onclick="openSettingsSection('${item.key}')">${item.label}</button>`).join('')}`;
  document.body.append(menu);
  const rect = button.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(innerWidth-menu.offsetWidth-8, rect.right-menu.offsetWidth))+'px';
  menu.style.top = Math.max(8, Math.min(innerHeight-menu.offsetHeight-8, rect.top-menu.offsetHeight-8))+'px';
  button.setAttribute('aria-expanded','true');
  menu.querySelector('button').focus();
}
function settingsSelect(key) {
  if (!settingsModules().some(item=>item.key===key)) return;
  settingsSelection = key;
  document.querySelectorAll('[data-settings-section]').forEach(section=>section.hidden = key !== 'all' && section.dataset.settingsSection !== key);
  document.getElementById('settingsViewTools').hidden = key === 'all';
  const section = document.querySelector(`[data-settings-section="${key}"]`);
  const heading = section?.querySelector('h2');
  if (heading) { heading.tabIndex = -1; heading.focus({preventScroll:true}); }
  document.querySelector('.main').scrollTo({top:0,behavior:'auto'});
}
function openSettingsSection(key) {
  closeSettingsMenu();
  if (currentPage !== 'settings') navigate('settings');
  if (currentPage === 'settings') settingsSelect(key);
}
document.addEventListener('click',event=>{ if (document.getElementById('settingsQuickMenu') && !event.target.closest('#settingsQuickMenu,#profileSettingsToggle')) closeSettingsMenu(); });
document.addEventListener('keydown',event=>{
  const menu = document.getElementById('settingsQuickMenu');
  if (!menu) return;
  if (event.key==='Escape') { event.preventDefault(); closeSettingsMenu(true); return; }
  if (!['ArrowUp','ArrowDown','Home','End'].includes(event.key)) return;
  event.preventDefault();
  const buttons = [...menu.querySelectorAll('button')], index = buttons.indexOf(document.activeElement);
  const next = event.key==='Home' ? 0 : event.key==='End' ? buttons.length-1 : (index + (event.key==='ArrowDown'?1:-1) + buttons.length)%buttons.length;
  buttons[next].focus();
});
window.addEventListener('resize',()=>closeSettingsMenu());
