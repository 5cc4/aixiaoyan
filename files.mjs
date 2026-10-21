import { mkdir, readdir, unlink, open, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fail, id, text, kinds } from './store.mjs';

export async function fileStorage(db, directory) {
  const folder = join(directory, 'uploads');
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const maxFile = Number(process.env.FILE_MAX_MB || 50) * 1024 ** 2;
  const quota = Number(process.env.FILE_QUOTA_GB || 5) * 1024 ** 3;
  if (!Number.isSafeInteger(maxFile) || !Number.isSafeInteger(quota) || maxFile < 1 || quota < maxFile) throw new Error('文件容量设置无效');
  // Only this module's generated filenames are eligible for crash cleanup.
  for (const name of await readdir(folder)) {
    const match = /^([a-f0-9-]{36})\.(part|blob)$/.exec(name);
    if (match && (match[2] === 'part' || !db.prepare('SELECT id FROM files WHERE id=?').get(match[1]))) await unlink(join(folder, name));
  }
  const uploading = new Set();
  let reserved = 0;
  const usage = () => db.prepare('SELECT coalesce(sum(size),0) AS used,count(*) AS count FROM files').get();
  function state() { return { ...usage(), maxFile, quota }; }
  function canAccess(file, userId) {
    return file.owner === userId || file.audience === 'all' || (file.audience === 'selected' && JSON.parse(file.recipients).includes(userId));
  }
  function list(user) {
    return db.prepare('SELECT f.*,u.name AS uploader FROM files f JOIN users u ON u.id=f.owner ORDER BY f.created DESC,f.id').all()
      .filter(file => canAccess(file, user.id))
      .map(({ recipients, ...file }) => ({ ...file, recipient_ids: JSON.parse(recipients) }));
  }
  async function upload(req, user, authenticate) {
    if (req.headers['content-type'] !== 'application/octet-stream') fail(415, '文件上传格式不正确');
    let name;
    try { name = decodeURIComponent(req.headers['x-file-name'] || ''); } catch { fail(400, '文件名编码不正确'); }
    name = text(name, '文件名', 180);
    if (/[\\/\u0000-\u001f\u007f]/.test(name) || name === '.' || name === '..') fail(400, '文件名含有不支持的字符');
    const size = Number(req.headers['content-length']);
    if (!Number.isSafeInteger(size) || size < 1 || size > maxFile) fail(413, `单个文件需大于 0 字节且不超过 ${maxFile / 1024 ** 2} MiB`);
    const kind = req.headers['x-record-kind'] || '';
    const recordId = req.headers['x-record-id'] || '';
    const audience = req.headers['x-file-audience'] || 'all';
    if (!['all', 'selected', 'private'].includes(audience)) fail(400, '请选择有效的文件访问范围');
    let recipients;
    try { recipients = JSON.parse(req.headers['x-file-recipients'] || '[]'); } catch { fail(400, '指定成员信息不正确'); }
    if (!Array.isArray(recipients) || recipients.length > 50 || recipients.some(value => typeof value !== 'string')) fail(400, '指定成员信息不正确');
    recipients = [...new Set(recipients)];
    if (audience === 'selected') {
      if (!recipients.length) fail(400, '至少选择一位共享成员');
      const members = db.prepare(`SELECT id FROM users WHERE active=1 AND id IN (${recipients.map(() => '?').join(',')})`).all(...recipients);
      if (members.length !== recipients.length) fail(400, '所选成员无效或已停用，请刷新后重试');
    } else recipients = [];
    let section = req.headers['x-file-section'] || 'shared';
    if (!['shared', 'literature', 'software', 'life'].includes(section)) fail(400, '请选择有效的资料板块');
    function checkRecord() {
      if (kind || recordId) {
        if (!kinds.includes(kind) || !db.prepare('SELECT id FROM records WHERE id=? AND kind=?').get(recordId, kind)) fail(409, '关联记录已不存在，请重新选择');
      }
    }
    checkRecord();
    if (kind === 'literature') section = 'literature';
    if (kind === 'software') section = 'software';
    if (kind === 'life') section = 'life';
    if (section === 'life' && kind !== 'life') fail(400, '生活资料必须关联到组内生活记录');
    if (section === 'software' && kind !== 'software') fail(400, '软件工具附件必须关联到软件工具记录');
    const used = usage();
    if (used.used + reserved + size > quota) fail(413, '共享空间容量不足，请联系管理员清理文件');
    if (used.count + uploading.size >= 5000) fail(413, '共享文件已达 5000 个，请先清理');
    if (uploading.has(user.id) || uploading.size >= 4) fail(429, '正在处理其他上传，请稍后重试');
    uploading.add(user.id);
    reserved += size;
    const fileId = id();
    const temp = join(folder, fileId + '.part');
    const target = join(folder, fileId + '.blob');
    let handle;
    let saved = false;
    let moved = false;
    try {
      handle = await open(temp, 'wx', 0o600);
      let received = 0;
      for await (const chunk of req) {
        received += chunk.length;
        if (received > size) fail(413, '文件大小与声明不一致');
        await handle.writeFile(chunk);
      }
      if (received !== size) fail(400, '文件没有完整上传，请重试');
      await handle.sync();
      await handle.close();
      handle = null;
      if (authenticate()?.id !== user.id) fail(401, '登录已失效，请重新登录后上传');
      checkRecord();
      await rename(temp, target);
      moved = true;
      db.prepare('INSERT INTO files (id,name,size,owner,kind,record_id,created,audience,recipients,section) VALUES (?,?,?,?,?,?,?,?,?,?)').run(fileId, name, size, user.id, kind, recordId, new Date().toISOString(), audience, JSON.stringify(recipients), section);
      saved = true;
      return { ok: true, id: fileId };
    } catch (error) {
      if (error.code === 'ENOSPC') fail(507, '服务器磁盘空间不足，请联系管理员');
      throw error;
    } finally {
      await handle?.close().catch(error => console.error('Upload close failed:', error.code));
      if (!saved) await unlink(moved ? target : temp).catch(error => { if (error.code !== 'ENOENT') console.error('Upload cleanup failed:', error.code); });
      reserved -= size;
      uploading.delete(user.id);
    }
  }
  async function download(fileId, res, user) {
    const file = db.prepare('SELECT * FROM files WHERE id=?').get(fileId);
    if (!file || !canAccess(file, user.id)) fail(404, '文件不存在或你没有查看权限');
    let handle;
    try { handle = await open(join(folder, file.id + '.blob'), 'r'); }
    catch (error) { if (error.code === 'ENOENT') fail(404, '文件内容缺失，请联系管理员恢复备份'); throw error; }
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream', 'Content-Length': file.size,
      'Content-Disposition': `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16))}`,
    });
    await pipeline(handle.createReadStream(), res);
  }
  async function remove(fileId, user) {
    const file = db.prepare('SELECT * FROM files WHERE id=?').get(fileId);
    if (!file) fail(404, '文件已被删除');
    if (user.role === 'student' && file.owner !== user.id) fail(403, '仅上传者、导师或管理员可以删除');
    for (const suffix of ['.thumb.jpg', '.preview.jpg']) await unlink(join(folder, file.id + suffix)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await unlink(join(folder, file.id + '.blob')).catch(error => { if (error.code !== 'ENOENT') throw error; });
    db.prepare('DELETE FROM files WHERE id=?').run(file.id);
    return { ok: true };
  }
  async function preview(fileId, res, user, thumbnail) {
    const file = db.prepare('SELECT * FROM files WHERE id=?').get(fileId);
    if (!file || !canAccess(file, user.id)) fail(404, '照片不存在或你没有查看权限');
    if (!/\.(jpe?g|png|gif|webp|heic)$/i.test(file.name)) fail(415, '此文件不支持照片预览');
    let handle;
    try {
      try { handle = await open(join(folder, file.id + (thumbnail ? '.thumb.jpg' : '.preview.jpg')), 'r'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; handle = await open(join(folder, file.id + '.blob'), 'r'); }
      const signature = Buffer.alloc(16);
      await handle.read(signature, 0, 16, 0);
      let type;
      if (signature[0] === 255 && signature[1] === 216 && signature[2] === 255) type = 'image/jpeg';
      else if (signature.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) type = 'image/png';
      else if (['GIF87a', 'GIF89a'].includes(signature.toString('ascii', 0, 6))) type = 'image/gif';
      else if (signature.toString('ascii', 0, 4) === 'RIFF' && signature.toString('ascii', 8, 12) === 'WEBP') type = 'image/webp';
      if (!type) fail(415, '暂时无法预览，请下载原图查看');
      const { size } = await handle.stat();
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Content-Disposition': 'inline' });
      await pipeline(handle.createReadStream({ start: 0 }), res);
    } finally { await handle?.close(); }
  }
  return { state, list, upload, download, remove, preview };
}
