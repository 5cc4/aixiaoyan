let storageInfo = { used: 0, quota: 5 * 1024 ** 3, maxFile: 50 * 1024 ** 2 };
let fileContext = null;
let activeUpload = null;
let uploadCancelled = false;
let uploadBusy = false;
let uploadSection = 'shared';
function formatSize(bytes) {
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let unit = 0;
  while (bytes >= 1024 && unit < units.length - 1) { bytes /= 1024; unit++; }
  return `${bytes.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}
function openRecordFiles(kind, index) {
  const record = data[kind][index];
  fileContext = { kind, id: record.id, title: record.title };
  navigate('files', true);
}
function allFiles() { fileContext = null; navigate('files'); }
function filesPage() {
  const toolContext = fileContext?.kind === 'software';
  const files = (data.files || []).filter(file => fileContext ? file.record_id === fileContext.id : file.section === 'shared' && file.kind !== 'life');
  const section = toolContext ? 'software' : 'shared';
  const used = Math.min(100, storageInfo.used / storageInfo.quota * 100);
  return `
    <section class="file-overview"><div><span class="eyebrow">${toolContext ? '软件工具资源' : '课题组共享空间'}</span><h2>${files.length} <small>个文件</small></h2><p>列表每 15 秒同步 · 下载权限按分享范围校验</p></div><div class="file-capacity"><div><span>${formatSize(storageInfo.used)} 已使用</span><span>共 ${formatSize(storageInfo.quota)}</span></div><progress value="${used}" max="100" aria-label="共享文件空间使用比例"></progress><small>单个文件上限 ${formatSize(storageInfo.maxFile)}</small></div></section>
    ${fileContext ? `<div class="file-context"><span>关联记录：${esc(fileContext.title)}</span><button class="subtle-link" onclick="allFiles()">查看全部文件 →</button></div>` : ''}
    ${toolrow('搜索文件名、上传者或关联记录…', '', `<button class="btn primary file-upload-button" onclick="uploadDialog('${section}')">＋ 上传${toolContext ? '工具资源' : '文件'}</button>`).replace('class="page-tools"', 'class="page-tools file-tools"')}
    <div class="file-grid" id="resourceCards">${files.map(file => {
      const record = data[file.kind]?.find(x => x.id === file.record_id);
      const association = record?.title || (file.record_id ? '原记录已删除' : '独立共享文件');
      const extension = file.name.includes('.') ? file.name.split('.').pop().slice(0, 8).toUpperCase() : 'FILE';
      const audience = file.audience === 'private' ? '仅上传者可见' : file.audience === 'selected' ? '指定成员可见' : '全组共享';
      return `<article class="card shared-file" data-component-id="${file.id}" data-search="${esc((file.name + ' ' + file.uploader + ' ' + association).toLowerCase())}"><div class="resource-card-top"><span class="file-type">${esc(extension)}</span><span class="file-size">${formatSize(file.size)}</span></div><h3 title="${esc(file.name)}">${esc(file.name)}</h3><p class="file-association">${esc(association)}</p><small>${esc(file.uploader)} · ${esc(new Date(file.created).toLocaleDateString('zh-CN'))} · ${audience}</small><div class="card-footer"><a class="btn file-download" href="/api/files/${file.id}" download>${icons.download} 下载</a>${currentUser.role !== 'student' || file.owner === currentUser.id ? `<button class="mini-btn" onclick="deleteSharedFile(this,'${file.id}')">删除</button>` : `<span class="tag">${audience}</span>`}</div></article>`;
    }).join('')}</div><div class="file-empty" id="cardsEmpty" ${files.length ? 'style="display:none"' : ''}><span>↥</span><h3>${files.length ? '没有找到匹配文件' : '这里可以放下第一份资料'}</h3><p>上传论文、表格、图片或代码压缩包，成员登录后即可下载。</p></div>`;
}
function uploadDialog(section = 'shared') {
  uploadSection = section;
  const groups = section === 'software' ? ['software'] : section === 'literature' ? ['literature'] : ['literature', 'submissions', 'publications', 'life'];
  const forceRecord = section === 'software';
  const selectedRecord = fileContext && groups.includes(fileContext.kind) ? `${fileContext.kind}:${fileContext.id}` : '';
  const recordOptions = groups.map(kind => `<optgroup label="${titles[kind]}">${data[kind].map(record => `<option value="${kind}:${record.id}" ${selectedRecord === `${kind}:${record.id}` ? 'selected' : ''}>${esc(record.title)}</option>`).join('')}</optgroup>`).join('');
  const recordSelect = forceRecord || section === 'literature' ? `<div class="field full"><label for="fileRecord">${forceRecord ? '所属软件工具' : '关联课题组文献（可选）'}</label><select id="fileRecord" ${forceRecord ? 'required' : ''}>${forceRecord ? '<option value="">请选择软件工具</option>' : '<option value="">未关联具体文献</option>'}${recordOptions}</select></div>` : `<div class="field full"><label for="fileRecord">关联记录（可选）</label><select id="fileRecord"><option value="">独立共享文件</option>${recordOptions}</select></div>`;
  const audienceControls = section === 'software' ? '<input id="fileAudience" type="hidden" value="all">' : `<div class="field full"><label for="fileAudience">分享范围</label><select id="fileAudience" onchange="toggleFileRecipients()"><option value="all">全体成员共享</option><option value="selected">仅分享给指定成员</option><option value="private">仅上传到此部分（仅自己可见）</option></select><small>指定成员和仅自己可见的权限会在下载时再次检查。</small></div><div class="field full" id="recipientField" hidden><label for="fileRecipients">选择成员（可多选）</label><select id="fileRecipients" multiple size="4">${data.members.filter(member => member.id !== currentUser.id).map(member => `<option value="${member.id}">${esc(member.name)} · ${esc(member.email)}</option>`).join('')}</select></div>`;
  document.getElementById('modalRoot').innerHTML = `<div class="overlay"><form class="modal" data-section="${section}" onsubmit="uploadFiles(event)"><div class="modal-head"><div><span class="eyebrow">${forceRecord ? 'SOFTWARE RESOURCES' : section === 'literature' ? 'SHARED LITERATURE' : 'SHARE WITH YOUR LAB'}</span><h2>上传${forceRecord ? '工具资源' : section === 'literature' ? '文献' : '文件'}</h2></div><button type="button" class="close" onclick="closeModal()" aria-label="关闭">×</button></div><div class="form-grid"><div class="field full"><label for="sharedFileInput">选择文件（每批最多 10 个）</label><input class="file-picker" id="sharedFileInput" type="file" multiple required><small>支持多选。单个文件不超过 ${formatSize(storageInfo.maxFile)}。</small></div>${recordSelect}${audienceControls}</div><div class="upload-progress" role="status" aria-live="polite"><p id="uploadStatus">${forceRecord ? '工具资源只显示在软件工具板块。' : section === 'literature' ? '上传的文献将自动归入“共享文献”。' : '选择共享范围后，系统会按成员权限显示和提供下载。'}</p><progress id="uploadProgress" max="100" value="0" aria-label="当前文件上传进度" hidden></progress></div><div class="modal-actions"><button type="button" class="btn" onclick="closeModal()">取消</button><button type="submit" class="btn primary">开始上传</button></div></form></div>`;
}
function toggleFileRecipients() {
  const field = document.getElementById('recipientField');
  if (field) field.hidden = document.getElementById('fileAudience').value !== 'selected';
}
function uploadOne(file, association, audience, recipients, section, status, progress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    activeUpload = request;
    request.open('POST', '/api/files');
    request.timeout = 300000;
    request.setRequestHeader('Content-Type', 'application/octet-stream');
    request.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    request.setRequestHeader('X-File-Audience', audience);
    request.setRequestHeader('X-File-Recipients', JSON.stringify(recipients));
    request.setRequestHeader('X-File-Section', section);
    if (association) {
      const [kind, recordId] = association.split(':');
      request.setRequestHeader('X-Record-Kind', kind);
      request.setRequestHeader('X-Record-Id', recordId);
    }
    request.upload.onprogress = event => {
      if (event.lengthComputable) progress.value = Math.round(event.loaded / event.total * 100);
      if (progress.value === 100) status.textContent = `${file.name}：正在保存…`;
    };
    request.onload = () => {
      let result;
      try { result = JSON.parse(request.responseText); } catch { reject(new Error('服务器未返回有效结果，请刷新列表确认')); return; }
      if (request.status === 200) resolve(result);
      else reject(Object.assign(new Error(result.error || '上传失败'), { status: request.status }));
    };
    request.onerror = () => reject(new Error('连接中断，请重新连接后查看文件列表'));
    request.ontimeout = () => reject(new Error('上传超时，请刷新列表确认结果，或缩小文件后重试'));
    request.onabort = () => reject(new Error('已取消当前上传，之前上传成功的文件已保留'));
    request.send(file);
  });
}
async function uploadFiles(event) {
  event.preventDefault();
  if (uploadBusy) return;
  const form = event.target;
  const selected = Array.from(form.querySelector('[type=file]').files);
  if (!selected.length || selected.length > 10) { toast('每批请选择 1–10 个文件'); return; }
  if (selected.some(file => !file.size || file.size > storageInfo.maxFile || file.name.length > 180)) { toast('文件不能为空，名称不能超过 180 字符，大小不能超过单文件上限'); return; }
  if (selected.reduce((sum, file) => sum + file.size, 0) > storageInfo.quota - storageInfo.used) { toast('共享空间剩余容量不足'); return; }
  const revision = sessionRevision;
  const association = form.querySelector('#fileRecord')?.value || '';
  const audience = form.querySelector('#fileAudience')?.value || 'all';
  const recipients = [...(form.querySelector('#fileRecipients')?.selectedOptions || [])].map(option => option.value);
  if (audience === 'selected' && !recipients.length) { toast('至少选择一位共享成员'); return; }
  const selectedKind = association.split(':')[0];
  const section = ['software', 'literature', 'life'].includes(selectedKind) ? selectedKind : form.dataset.section;
  const status = form.querySelector('#uploadStatus');
  const progress = form.querySelector('progress');
  const inputs = form.querySelectorAll('input,select,[type=submit]');
  inputs.forEach(input => input.disabled = true);
  uploadBusy = true;
  uploadCancelled = false;
  progress.hidden = false;
  let completed = 0;
  try {
    for (const file of selected) {
      if (uploadCancelled || revision !== sessionRevision) break;
      status.textContent = `正在上传 ${completed + 1}/${selected.length}：${file.name}`;
      progress.value = 0;
      await uploadOne(file, association, audience, recipients, section, status, progress);
      activeUpload = null;
      completed++;
    }
    if (revision === sessionRevision && !uploadCancelled) { status.textContent = `已上传 ${completed} 个文件。`; toast(`已上传 ${completed} 个文件`); }
  } catch (error) {
    if (revision === sessionRevision) {
      status.textContent = `本批已成功 ${completed} 个。${error.message}。如需重试，请重新选择未成功的文件。`;
      if (error.status === 401) showAuth('login');
    }
  } finally {
    activeUpload = null;
    uploadBusy = false;
    inputs.forEach(input => input.disabled = false);
    form.querySelector('[type=file]').value = '';
    if (revision === sessionRevision && currentUser) {
      await loadState(false).catch(() => toast('暂时无法刷新列表，请稍后刷新页面'));
      if (revision === sessionRevision && currentUser && currentPage === 'files') document.getElementById('content').innerHTML = filesPage();
    }
  }
}
async function deleteSharedFile(button, fileId) {
  const file = data.files.find(item => item.id === fileId);
  if (!file || !confirm(`删除“${file.name}”？全组将无法再下载此文件，此操作无法撤销。`)) return;
  await perform(button, async () => { await api(`/files/${fileId}`, 'DELETE', {}); await loadState(); toast('文件已删除'); });
}
