let avatarImage = null;
let avatarChoice = 0;
function avatarContents(user) {
  return `<span>${esc(user.name?.[0] || '研')}</span>${user.avatar ? `<img src="${esc(user.avatar)}" alt="${esc(user.name)}的头像" loading="lazy" onerror="this.remove()">` : ''}`;
}
function avatarDialog() {
  if (!currentUser) return;
  avatarImage = null; avatarChoice++;
  document.getElementById('modalRoot').innerHTML = `<div class="overlay" onclick="if(event.target===this)closeModal()"><form class="modal avatar-editor" onsubmit="saveAvatar(event)"><div class="modal-head"><h2>编辑头像</h2><button type="button" class="close" onclick="closeModal()" aria-label="关闭头像编辑">×</button></div><div class="avatar avatar-current">${avatarContents(currentUser)}</div><canvas id="avatarCanvas" width="256" height="256" hidden aria-label="头像裁切预览"></canvas><div class="field full"><label for="avatarFile">选择图片（最大 10 MiB）</label><input id="avatarFile" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onchange="chooseAvatar(this)"></div><div class="avatar-crop-controls" id="avatarCropControls" hidden>${[['avatarZoom','缩放',1,3,.05,1],['avatarX','左右位置',0,100,1,50],['avatarY','上下位置',0,100,1,50]].map(([id,label,min,max,step,value])=>`<label for="${id}">${label}<input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" oninput="drawAvatar()"></label>`).join('')}</div><p>头像会裁切成正方形，并以圆形显示。保存后同步给课题组成员。</p><div class="modal-actions">${currentUser.avatar ? '<button type="button" class="btn" onclick="removeAvatar(this)">恢复文字头像</button>' : ''}<button type="button" class="btn" onclick="closeModal()">取消</button><button id="avatarSave" class="btn primary" type="submit" disabled>保存头像</button></div></form></div>`;
}
async function chooseAvatar(input) {
  const file = input.files[0];
  if (!file) return;
  if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type) || file.size > 10 * 1024 ** 2) return toast('请选择 10 MiB 以内的 JPG、PNG、WebP 或 GIF 图片');
  const choice = ++avatarChoice, revision = sessionRevision;
  try {
    const url = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('无法读取本地图片文件，请重新选择'));
      reader.readAsDataURL(file);
    });
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
    if (choice !== avatarChoice || revision !== sessionRevision || !document.getElementById('avatarCanvas')) return;
    if (!image.naturalWidth) throw new Error('图片内容无效，请选择其他图片');
    if (image.naturalWidth * image.naturalHeight > 64_000_000) throw new Error('图片分辨率过高，请选择 6400 万像素以内的图片');
    avatarImage = image;
    document.getElementById('avatarCanvas').hidden = false;
    document.querySelector('.avatar-current').hidden = true;
    document.getElementById('avatarCropControls').hidden = false;
    document.getElementById('avatarSave').disabled = false;
    for (const [id, value] of [['avatarZoom',1],['avatarX',50],['avatarY',50]]) document.getElementById(id).value = value;
    drawAvatar();
  } catch (error) { if (revision === sessionRevision) toast(error.message || '无法解码此图片，请选择 JPG、PNG、WebP 或 GIF 图片'); }
}
function drawAvatar() {
  const canvas = document.getElementById('avatarCanvas');
  if (!canvas || !avatarImage) return;
  const scale = 256 / Math.min(avatarImage.naturalWidth, avatarImage.naturalHeight) * Number(document.getElementById('avatarZoom').value);
  const width = avatarImage.naturalWidth * scale, height = avatarImage.naturalHeight * scale;
  const x = -(width - 256) * Number(document.getElementById('avatarX').value) / 100;
  const y = -(height - 256) * Number(document.getElementById('avatarY').value) / 100;
  const context = canvas.getContext('2d');
  context.fillStyle = '#f1eef7'; context.fillRect(0,0,256,256);
  context.drawImage(avatarImage,x,y,width,height);
}
async function avatarUpdated(revision) {
  if (revision !== sessionRevision || !currentUser) return;
  await loadState(false);
  if (revision !== sessionRevision || !currentUser) return;
  closeModal(true);
  avatarImage = null;
  if (currentPage === 'members') document.getElementById('content').innerHTML = membersPage();
  loadGroupChat();
  toast('头像已保存并同步');
}
async function saveAvatar(event) {
  event.preventDefault();
  if (!avatarImage) return;
  const revision = sessionRevision;
  await perform(event.target.querySelector('[type=submit]'), async () => {
    const blob = await new Promise(resolve => document.getElementById('avatarCanvas').toBlob(resolve, 'image/jpeg', .9));
    if (!blob || blob.size > 256 * 1024) throw new Error('无法生成头像，请重新选择图片');
    const response = await fetch('/api/avatar', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'image/jpeg' }, body: blob, signal: AbortSignal.timeout(30000) });
    const result = await response.json();
    if (!response.ok) { if (response.status === 401 && revision === sessionRevision) showAuth('login'); throw new Error(result.error || '头像保存失败'); }
    await avatarUpdated(revision);
  });
}
async function removeAvatar(button) {
  const revision = sessionRevision;
  await perform(button, async () => { await api('/avatar', 'DELETE'); await avatarUpdated(revision); });
}
