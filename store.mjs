import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';

export const kinds = ['submissions', 'literature', 'publications', 'software', 'life'];
export const statuses = ['draft', 'submitted', 'under_review', 'revision', 'major_revision', 'minor_revision', 'accepted', 'published', 'rejected'];
export const hash = value => createHash('sha256').update(value).digest('hex');
export const id = () => randomUUID();
export function fail(status, message) { throw Object.assign(new Error(message), { status }); }
export function text(value, name, max = 200, required = true) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) || (required && !value.trim())) fail(400, `${name}格式不正确`);
  return value.trim();
}
export function email(value) {
  const result = text(value, '邮箱', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) fail(400, '请输入有效邮箱');
  return result;
}
const derive = promisify(scrypt);
export async function passwordHash(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) fail(400, '密码需要 12–128 个字符');
  const salt = randomBytes(16).toString('hex');
  const key = await derive(value, salt, 64);
  return `${salt}:${key.toString('hex')}`;
}
export async function passwordMatches(value, stored) {
  if (typeof value !== 'string' || value.length > 128) return false;
  const [salt, digest] = stored.split(':');
  const key = await derive(value, salt, 64);
  return timingSafeEqual(key, Buffer.from(digest, 'hex'));
}

export function recordInput(kind, body) {
  if (!kinds.includes(kind) || !body || typeof body !== 'object' || Array.isArray(body)) fail(400, '记录类型或内容不正确');
  const fields = {
    submissions: ['title', 'journal', 'author', 'date', 'deadline', 'status'],
    literature: ['title', 'authors', 'journal', 'year', 'tags', 'doi', 'type'],
    publications: ['title', 'authors', 'journal', 'year', 'doi'],
    software: ['title', 'description', 'category', 'release', 'tags', 'instructions', 'url', 'icon', 'color'],
    life: ['title', 'description', 'category', 'version', 'tags'],
  }[kind];
  const limits = { description: 6000, instructions: 12000, url: 2048, icon: 12, color: 7 };
  const result = Object.fromEntries(fields.map(key => {
    const value = key === 'release' ? body.release ?? (typeof body.version === 'string' ? body.version : '') : body[key];
    return [key, text(value ?? '', key, limits[key] ?? 600, key === 'title')];
  }));
  if ('year' in result && result.year && !/^\d{4}$/.test(result.year)) fail(400, '年份必须为四位数字');
  if (kind === 'submissions') {
    result.status ||= 'submitted';
    if (!statuses.includes(result.status)) fail(400, '投稿状态不正确');
    for (const key of ['date', 'deadline']) if (result[key] && (!/^\d{4}-\d{2}-\d{2}$/.test(result[key]) || !Number.isFinite(Date.parse(result[key])) || new Date(result[key]).toISOString().slice(0, 10) !== result[key])) fail(400, '日期不正确');
  }
  if (kind === 'literature') result.type = 'PDF';
  if (kind === 'software') {
    if (result.url) {
      let url;
      try { url = new URL(result.url); } catch { fail(400, '请输入完整的工具网址，例如 https://example.com'); }
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) fail(400, '工具网址仅支持不含登录凭据的 HTTP / HTTPS 地址');
    }
    if (result.color && !/^#[a-f0-9]{6}$/i.test(result.color)) fail(400, '图标颜色格式不正确');
    if (/[\r\n]/.test(result.icon)) fail(400, '图标文字不能换行');
  }
  return result;
}

const dashboardWidgets = ['welcome', 'insight', 'progress', 'shortcuts', 'literature-stat', 'publications-stat', 'submissions-stat', 'members-stat', 'schedule', 'bookshelf', 'shared-files', 'publications', 'tools', 'note'];
export function dashboardInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, '工作台设置不正确');
  if (!Array.isArray(body.layout) || !body.layout.length || body.layout.length > dashboardWidgets.length || body.layout.some(key => !dashboardWidgets.includes(key)) || new Set(body.layout).size !== body.layout.length) fail(400, '组件列表不正确，请至少保留一个组件');
  if (!body.copy || typeof body.copy !== 'object' || Array.isArray(body.copy)) fail(400, '工作台文字不正确');
  const limits = { eyebrow: 100, greeting: 100, title: 120, caption: 300, noteTitle: 80, note: 2000 };
  const copy = Object.fromEntries(Object.entries(limits).map(([key, max]) => [key, text(body.copy[key], '工作台文字', max, key === 'title')]));
  const { fontSize, fontWeight, fontFamily, color } = body.copy;
  if (!Number.isInteger(fontSize) || fontSize < 36 || fontSize > 80 || ![400, 500, 600, 700].includes(fontWeight) || !['system', 'serif'].includes(fontFamily) || typeof color !== 'string' || !/^#[a-f0-9]{6}$/i.test(color)) fail(400, '字体设置不正确');
  const labels = body.labels ?? {};
  if (!labels || typeof labels !== 'object' || Array.isArray(labels) || Object.keys(labels).some(key => !dashboardWidgets.includes(key))) fail(400, '组件文字设置不正确');
  const cleanLabels = Object.fromEntries(Object.entries(labels).map(([key, value]) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, '组件文字设置不正确');
    return [key, { title: text(value.title, '组件标题', 80), subtitle: text(value.subtitle, '组件说明', 300, false) }];
  }));
  const dimensions = body.dimensions ?? {};
  if (!dimensions || typeof dimensions !== 'object' || Array.isArray(dimensions) || Object.keys(dimensions).some(key => ![...dashboardWidgets, 'sidebar', 'chat', 'lifeHero'].includes(key))) fail(400, '界面尺寸不正确');
  for (const [key, value] of Object.entries(dimensions)) {
    const maxWidth = dashboardWidgets.includes(key) ? 4 : key === 'lifeHero' ? 2400 : 420;
    const minWidth = dashboardWidgets.includes(key) ? 1 : 160;
    if (!value || Object.keys(value).some(field => !['width', 'height'].includes(field)) || !Number.isInteger(value.width) || value.width < minWidth || value.width > maxWidth || !Number.isInteger(value.height) || value.height < 120 || value.height > 1600) fail(400, '界面尺寸超出范围');
  }
  const navKeys = ['dashboard', 'files', 'literature', 'publications', 'submissions', 'ai', 'software', 'life', 'members', 'settings'];
  const navigation = body.navigation ?? [navKeys.slice(0, 7), navKeys.slice(7)];
  if (!Array.isArray(navigation) || navigation.length !== 2 || navigation.some(group => !Array.isArray(group)) || navigation.flat().length !== navKeys.length || new Set(navigation.flat()).size !== navKeys.length || navigation.flat().some(key => !navKeys.includes(key))) fail(400, '导航顺序不正确');
  const componentOrder = body.componentOrder ?? {};
  if (!componentOrder || typeof componentOrder !== 'object' || Array.isArray(componentOrder) || Object.keys(componentOrder).some(page => !navKeys.includes(page))) fail(400, '页面组件顺序不正确');
  for (const groups of Object.values(componentOrder)) {
    if (!groups || typeof groups !== 'object' || Array.isArray(groups) || Object.keys(groups).length > 100) fail(400, '组件分组不正确');
    for (const [group, keys] of Object.entries(groups)) {
      if (!/^[a-z0-9:_-]{1,90}$/i.test(group) || !Array.isArray(keys) || keys.length > 5000 || new Set(keys).size !== keys.length || keys.some(key => typeof key !== 'string' || key.length > 100 || !key.length)) fail(400, '组件顺序不正确');
    }
  }
  const widgets = body.toolWidgets ?? [];
  if (!Array.isArray(widgets) || widgets.length > 80 || new Set(widgets.map(widget => widget?.id)).size !== widgets.length) fail(400, '个人桌面最多添加 80 个组件或链接，且标识不能重复');
  const toolWidgets = widgets.map(widget => {
    if (!widget || !/^[a-f0-9-]{36}$/.test(widget.id) || !['link', 'clock', 'note', 'todo', 'countdown'].includes(widget.type)) fail(400, '桌面组件不正确');
    const title = text(widget.title, '组件名称', 80);
    const category = text(widget.category ?? '', '组件分类', 80, false) || '组件';
    if (!/^#[a-f0-9]{6}$/i.test(widget.color) || ![1, 2, 3].includes(widget.size)) fail(400, '组件颜色或尺寸不正确');
    const result = { id: widget.id, type: widget.type, title, category, color: widget.color, size: widget.type === 'link' ? 1 : Math.max(2, widget.size) };
    if (widget.type === 'link') {
      const link = recordInput('software', { title, url: widget.url, icon: widget.icon ?? '' });
      if (!link.url) fail(400, '请填写链接网址');
      result.url = link.url; result.icon = link.icon;
    }
    if (widget.type === 'note') result.text = text(widget.text ?? '', '便签', 4000, false);
    if (widget.type === 'countdown') {
      result.date = text(widget.date, '目标日期', 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(result.date) || !Number.isFinite(Date.parse(result.date)) || new Date(result.date).toISOString().slice(0, 10) !== result.date) fail(400, '目标日期不正确');
    }
    if (widget.type === 'todo') {
      if (!Array.isArray(widget.items) || widget.items.length > 40) fail(400, '每个待办组件最多 40 项');
      result.items = widget.items.map(item => {
        if (!item || typeof item.done !== 'boolean') fail(400, '待办内容不正确');
        return { text: text(item.text, '待办', 160), done: item.done };
      });
    }
    return result;
  });
  return { layout: body.layout, copy: { ...copy, fontSize, fontWeight, fontFamily, color }, labels: cleanLabels, dimensions, navigation, componentOrder, toolWidgets };
}

export function openStore(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(directory, 'lab.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','advisor','student')),field TEXT NOT NULL DEFAULT '',active INTEGER NOT NULL DEFAULT 1,created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS invites (token TEXT PRIMARY KEY,role TEXT NOT NULL,expires INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY,kind TEXT NOT NULL,owner TEXT NOT NULL REFERENCES users(id),body TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,created TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS records_kind ON records(kind);
    CREATE TABLE IF NOT EXISTS dashboard_preferences (user_id TEXT PRIMARY KEY REFERENCES users(id),body TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY,name TEXT NOT NULL,size INTEGER NOT NULL,owner TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL DEFAULT '',record_id TEXT NOT NULL DEFAULT '',created TEXT NOT NULL,audience TEXT NOT NULL DEFAULT 'all',recipients TEXT NOT NULL DEFAULT '[]',section TEXT NOT NULL DEFAULT 'shared');
    CREATE TABLE IF NOT EXISTS configs (id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES users(id),scope TEXT NOT NULL,provider TEXT NOT NULL,label TEXT NOT NULL,model TEXT NOT NULL,base TEXT NOT NULL,key TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES users(id),title TEXT NOT NULL,messages TEXT NOT NULL DEFAULT '[]',updated TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS chats_owner ON chats(owner);
    CREATE TABLE IF NOT EXISTS chat_projects (id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS chat_project_links (chat_id TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,project_id TEXT NOT NULL REFERENCES chat_projects(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS user_avatars (user_id TEXT PRIMARY KEY REFERENCES users(id),image BLOB NOT NULL,version TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS group_messages (seq INTEGER PRIMARY KEY AUTOINCREMENT,owner TEXT NOT NULL REFERENCES users(id),body TEXT NOT NULL,created TEXT NOT NULL,client_id TEXT NOT NULL,UNIQUE(owner,client_id));
    CREATE TABLE IF NOT EXISTS ai_usage (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),config_id TEXT NOT NULL,created TEXT NOT NULL,status TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS usage_user_date ON ai_usage(user_id,created);
    CREATE TABLE IF NOT EXISTS mailbox_settings (id INTEGER PRIMARY KEY CHECK(id=1),email TEXT NOT NULL,secret TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,updated TEXT NOT NULL,last_uid INTEGER NOT NULL DEFAULT 0,last_checked TEXT NOT NULL DEFAULT '',last_error TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS mailbox_messages (id TEXT PRIMARY KEY,uid INTEGER NOT NULL UNIQUE,message_id TEXT NOT NULL DEFAULT '',subject TEXT NOT NULL,sender TEXT NOT NULL,received TEXT NOT NULL,status TEXT NOT NULL,submission_id TEXT NOT NULL DEFAULT '',decision TEXT NOT NULL DEFAULT 'pending',created TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS mailbox_messages_decision ON mailbox_messages(decision,received DESC);
  `);
  const mailboxColumns = new Set(db.prepare('PRAGMA table_info(mailbox_settings)').all().map(column => column.name));
  if (!db.prepare('PRAGMA table_info(mailbox_messages)').all().some(column => column.name === 'journal')) db.exec("ALTER TABLE mailbox_messages ADD COLUMN journal TEXT NOT NULL DEFAULT ''");
  if (!db.prepare('PRAGMA table_info(mailbox_messages)').all().some(column => column.name === 'review_default')) db.exec('ALTER TABLE mailbox_messages ADD COLUMN review_default INTEGER NOT NULL DEFAULT 0');
  for (const [name, definition] of [['last_uid', 'INTEGER NOT NULL DEFAULT 0'], ['last_checked', "TEXT NOT NULL DEFAULT ''"], ['last_error', "TEXT NOT NULL DEFAULT ''"]]) {
    if (!mailboxColumns.has(name)) db.exec(`ALTER TABLE mailbox_settings ADD COLUMN ${name} ${definition}`);
  }
  const fileColumns = new Set(db.prepare('PRAGMA table_info(files)').all().map(column => column.name));
  for (const [name, definition] of [['audience', "TEXT NOT NULL DEFAULT 'all'"], ['recipients', "TEXT NOT NULL DEFAULT '[]'"], ['section', "TEXT NOT NULL DEFAULT 'shared'"]]) {
    if (!fileColumns.has(name)) db.exec(`ALTER TABLE files ADD COLUMN ${name} ${definition}`);
  }
  db.exec("UPDATE files SET section='software' WHERE kind='software'; UPDATE files SET section='literature' WHERE kind='literature'; UPDATE files SET section='life' WHERE kind='life';");
  const keyPath = join(directory, 'encryption.key');
  if (!existsSync(keyPath)) {
    if (db.prepare('SELECT count(*) AS n FROM configs').get().n) fail(500, '加密密钥文件缺失，请恢复备份中的 encryption.key');
    writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: 'wx' });
  }
  const key = readFileSync(keyPath);
  if (key.length !== 32) fail(500, '加密密钥文件不正确');
  const tokenPath = join(directory, 'setup-token.txt');
  if (!existsSync(tokenPath) && !db.prepare('SELECT count(*) AS n FROM users').get().n) writeFileSync(tokenPath, randomBytes(24).toString('hex'), { mode: 0o600, flag: 'wx' });
  const setupToken = existsSync(tokenPath) ? readFileSync(tokenPath, 'utf8').trim() : '';
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function encrypt(value) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map(x => x.toString('base64')).join(':');
  }
  function decrypt(value) {
    const [iv, tag, encrypted] = value.split(':').map(x => Buffer.from(x, 'base64'));
    const cipher = createDecipheriv('aes-256-gcm', key, iv);
    cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(encrypted), cipher.final()]).toString('utf8');
  }
  return { db, setupToken, transaction, encrypt, decrypt };
}
