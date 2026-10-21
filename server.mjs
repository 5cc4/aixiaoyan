import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { checkMailbox, scanMailbox, detectJournal, journalKey, classifyStatus, isDefaultReview, authorConfirmation, readMailboxMessage } from './mailbox.mjs';
import { openStore, hash, id, fail, text, email, passwordHash, passwordMatches, recordInput, dashboardInput, kinds } from './store.mjs';
import { catalog, configInput, callModel, streamModel } from './ai.mjs';
import { fileStorage } from './files.mjs';
import { createGateway, gatewayBase } from './gateway.mjs';
import { readChatDocument, chatUserTurn, chatModelMessage } from './chat-documents.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const publicFiles = new Map([['/', ['index.html', 'text/html']], ...['dashboard.js', 'navigation.js', 'components.js', 'ui-resize.js', 'avatars.js', 'settings-menu.js', 'client.js', 'files.js', 'tools.js', 'tool-widgets.js', 'tools.css', 'appearance.css', 'collaboration.css', 'files.css', 'research-theme.css', 'dashboard-layout.css'].map(x => [`/${x}`, [x, x.endsWith('.js') ? 'text/javascript' : 'text/css']])]);
const now = () => new Date().toISOString();
const avatarUrl = (userId, version) => version ? `/api/avatars/${userId}?v=${version}` : '';
const publicUser = x => ({ id: x.id, name: x.name, email: x.email, role: x.role, field: x.field, active: Boolean(x.active), avatar: avatarUrl(x.id, x.avatar_version) });
const publicConfig = x => ({ id: x.id, scope: x.scope, provider: x.provider, label: x.label, model: x.model, base: x.base, enabled: Boolean(x.enabled), hasKey: Boolean(x.key) });
const publicRecord = x => {
  const value = JSON.parse(x.body);
  if (x.kind === 'software') value.release ??= typeof value.version === 'string' ? value.version : '';
  return { ...value, id: x.id, owner: x.owner, version: x.version, created: x.created };
};

export async function createApplication(options = {}) {
  const dataDir = options.dataDir || process.env.DATA_DIR || join(root, 'data');
  const { db, setupToken, transaction, encrypt, decrypt } = openStore(dataDir);
  const files = await fileStorage(db, dataDir);
  const gateway = await createGateway(process.env.FREELLMAPI_CONFIG_PATH);
  const available = catalog(options.extraBases ?? process.env.AI_EXTRA_BASE_URLS ?? '', Boolean(gateway));
  let gatewaySaving = false;
  let mailboxPolling = false;
  let readingMail = 0;
  const aiCall = options.aiCall || callModel;
  const origin = options.origin ?? process.env.PUBLIC_ORIGIN ?? '';
  if (origin && new URL(origin).origin !== origin) throw new Error('PUBLIC_ORIGIN 必须是不含路径的完整网址');
  const secure = options.secure ?? (process.env.COOKIE_SECURE === 'true' || origin.startsWith('https:'));
  const dailyLimit = Number(options.dailyLimit ?? process.env.AI_DAILY_LIMIT ?? 50);
  if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 10000) throw new Error('AI_DAILY_LIMIT 必须为 1–10000');
  const dummyPassword = await passwordHash(randomBytes(24).toString('hex'));
  const rate = new Map();
  const pendingChats = new Set();
  const activeCalls = new Map();
  const modelRetryAfter = new Map();
  let hashing = 0;
  let totalCalls = 0;
  const timer = setInterval(() => {
    for (const [key, entry] of rate) if (entry.until < Date.now()) rate.delete(key);
    db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
    db.prepare('DELETE FROM invites WHERE expires < ?').run(Date.now());
  }, 60000).unref();
  const mailboxTimer = setInterval(() => { pollMailbox(); }, 5 * 60000).unref();
  function limit(key, max, milliseconds = 60000) {
    let entry = rate.get(key);
    if (!entry || entry.until < Date.now()) { entry = { count: 0, until: Date.now() + milliseconds }; rate.set(key, entry); }
    if (++entry.count > max) fail(429, '请求过于频繁，请稍后再试');
  }
  async function hashWork(fn) {
    if (hashing >= 6) fail(429, '登录请求较多，请稍后再试');
    hashing++;
    try { return await fn(); } finally { hashing--; }
  }
  function admin(user) { if (user.role !== 'admin') fail(403, '此操作仅管理员可用'); }
  function canModify(user, record) { if (user.role === 'student' && record.owner !== user.id) fail(403, '仅记录创建者、导师或管理员可以修改'); }
  function knownJournals() {
    const records = db.prepare("SELECT body FROM records WHERE kind='submissions'").all().map(row => JSON.parse(row.body).journal);
    const confirmed = db.prepare("SELECT DISTINCT journal FROM mailbox_messages WHERE journal<>''").all().map(row => row.journal);
    return [...records, ...confirmed].filter(name => typeof name === 'string' && name.trim());
  }
  const updateJournal = db.prepare('UPDATE mailbox_messages SET journal=? WHERE id=?');
  const existingJournals = knownJournals();
  for (const message of db.prepare("SELECT m.id,m.subject,r.body FROM mailbox_messages m LEFT JOIN records r ON r.id=m.submission_id AND r.kind='submissions' WHERE m.journal=''").all()) {
    const name = (message.body && JSON.parse(message.body).journal) || detectJournal(message.subject, '', existingJournals);
    if (name) updateJournal.run(name, message.id);
  }
  const updateReview = db.prepare("UPDATE mailbox_messages SET status='under_review',review_default=? WHERE id=?");
  for (const message of db.prepare("SELECT id,subject,status FROM mailbox_messages WHERE decision<>'ignored'").all()) {
    if ((!message.status || authorConfirmation(message.subject)) && classifyStatus(message.subject) === 'under_review') updateReview.run(Number(isDefaultReview(message.subject)), message.id);
  }
  db.prepare("UPDATE mailbox_messages SET decision='applied' WHERE decision='pending' AND journal<>'' AND status IN ('submitted','under_review','revision','accepted','published')").run();
  async function pollMailbox() {
    if (mailboxPolling) return { scanned: 0 };
    const config = db.prepare('SELECT * FROM mailbox_settings WHERE id=1 AND enabled=1').get();
    if (!config) return { scanned: 0 };
    mailboxPolling = true;
    try {
      const { messages, lastUid } = await scanMailbox(config.email, decrypt(config.secret), config.last_uid);
      const insert = db.prepare('INSERT OR IGNORE INTO mailbox_messages(id,uid,message_id,subject,sender,received,status,submission_id,decision,created,journal,review_default) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
      const known = knownJournals();
      let scanned = 0;
      for (const message of messages) {
        if (config.last_uid === 0 && message.received < config.updated) continue;
        const journal = detectJournal(message.subject, message.text, known);
        const decision = journal && ['submitted', 'under_review', 'revision', 'accepted', 'published'].includes(message.status) ? 'applied' : 'pending';
        scanned += insert.run(id(), message.uid, message.messageId, message.subject, message.sender, message.received, message.status, '', decision, now(), journal, Number(message.reviewDefault)).changes;
      }
      db.prepare("UPDATE mailbox_settings SET last_uid=?,last_checked=?,last_error='' WHERE id=1").run(lastUid, now());
      return { scanned };
    } catch {
      db.prepare("UPDATE mailbox_settings SET last_checked=?,last_error='收件箱检查失败，请确认授权码和 IMAP 设置' WHERE id=1").run(now());
      return { scanned: 0, error: '收件箱检查失败，请确认授权码和 IMAP 设置' };
    } finally { mailboxPolling = false; }
  }
  queueMicrotask(() => { pollMailbox(); });
  function tokenFrom(req) { return /(?:^|;\s*)qiyan_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1] || ''; }
  function userFrom(req) {
    const token = tokenFrom(req);
    return token ? db.prepare('SELECT u.*,a.version AS avatar_version FROM users u JOIN sessions s ON s.user_id=u.id LEFT JOIN user_avatars a ON a.user_id=u.id WHERE s.token=? AND s.expires>? AND u.active=1').get(hash(token), Date.now()) : null;
  }
  function session(res, user) {
    const token = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash(token), user.id, Date.now() + 7 * 86400000);
    res.setHeader('Set-Cookie', `qiyan_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${secure ? '; Secure' : ''}`);
  }
  function getConfig(configId, user, modify = false) {
    if (configId === 'xiaoyan-auto') {
      if (modify) fail(400, '小研AI由系统自动管理');
      return { id: 'xiaoyan-auto', owner: user.id, scope: 'global', provider: 'freellmapi', label: '小研AI', model: 'auto', base: gatewayBase, key: '', enabled: 1 };
    }
    const config = db.prepare('SELECT * FROM configs WHERE id=?').get(configId);
    if (!config || (config.scope === 'personal' && config.owner !== user.id)) fail(404, '模型配置不存在');
    if (modify && config.scope === 'global') admin(user);
    return config;
  }
  function getChat(chatId, user) {
    const chat = db.prepare("SELECT c.*,COALESCE(l.project_id,'') AS project_id FROM chats c LEFT JOIN chat_project_links l ON l.chat_id=c.id WHERE c.id=? AND c.owner=?").get(chatId, user.id);
    if (!chat) fail(404, '对话不存在');
    return { ...chat, messages: JSON.parse(chat.messages) };
  }
  async function generate(user, config, messages) {
    if (!config.enabled) fail(400, '此模型已停用');
    if ((activeCalls.get(user.id) || 0) >= 2 || totalCalls >= 8) fail(429, '已有 AI 请求正在处理，请稍后再试');
    const used = db.prepare('SELECT count(*) AS n FROM ai_usage WHERE user_id=? AND created>=?').get(user.id, now().slice(0, 10)).n;
    if (used >= dailyLimit) fail(429, `今天已达到 ${dailyLimit} 次 AI 调用上限（含连接测试）`);
    const usageId = id();
    db.prepare('INSERT INTO ai_usage VALUES (?,?,?,?,?)').run(usageId, user.id, config.id, now(), 'pending');
    activeCalls.set(user.id, (activeCalls.get(user.id) || 0) + 1);
    totalCalls++;
    try {
      const answer = await aiCall({ ...config, apiKey: decrypt(config.key) }, messages, available);
      // Injected transports are used only by automated tests; validate their output too.
      if (typeof answer !== 'string' || !answer.trim() || answer.length > 60000) fail(502, 'AI 返回内容无效');
      db.prepare('UPDATE ai_usage SET status=? WHERE id=?').run('success', usageId);
      return answer;
    } catch (error) {
      db.prepare('UPDATE ai_usage SET status=? WHERE id=?').run('failed', usageId);
      throw error;
    } finally { totalCalls--; activeCalls.set(user.id, activeCalls.get(user.id) - 1); }
  }
  async function generateAutomatic(user, messages) {
    const pool = db.prepare("SELECT * FROM configs WHERE provider='freellmapi' AND scope='global' AND enabled=1 ORDER BY label,model").all();
    if (!pool.length) fail(503, '小研AI暂时没有可用的免费模型');
    const priority = config => config.model === 'Qwen/Qwen3-8B' ? 0 :
      config.model === 'glm-4.7-flash' ? 1 :
      config.model === 'liquid/lfm-2.5-2.6b:free' ? 2 :
      config.model === 'XingChenAGI/Xing4.0-29B' ? 3 :
      config.model.startsWith('openai/gpt-oss-') ? 8 :
      config.model === 'openrouter/free' ? 9 : 5;
    pool.sort((a, b) => priority(a) - priority(b));
    const errors = [];
    for (const candidate of pool.slice(0, Math.min(3, pool.length))) {
      try { return await generate(user, candidate, messages); }
      catch (error) { errors.push(error); }
    }
    const last = errors.at(-1);
    fail(last?.status || 503, '小研AI当前的免费模型暂不可用，请稍后重试；系统没有切换到付费模型。');
  }
  async function generateAutomaticStream(user, messages, res) {
    const startedAt = performance.now();
    const pool = db.prepare("SELECT * FROM configs WHERE provider='freellmapi' AND scope='global' AND enabled=1").all();
    if (!pool.length) fail(503, '小研AI暂时没有可用的免费模型');
    const priority = config => config.model === 'Qwen/Qwen3-8B' ? 0 : config.model === 'glm-4.7-flash' ? 1 : config.model === 'liquid/lfm-2.5-2.6b:free' ? 2 : config.model === 'XingChenAGI/Xing4.0-29B' ? 3 : config.model === 'openrouter/free' ? 9 : 5;
    pool.sort((a, b) => priority(a) - priority(b));
    const candidates = pool.filter(config => (modelRetryAfter.get(config.id) || 0) <= Date.now()).slice(0, 3);
    if (!candidates.length) fail(503, '免费模型服务暂时繁忙，请一分钟后重试。');
    if ((activeCalls.get(user.id) || 0) >= 2 || totalCalls >= 8) fail(429, '已有 AI 请求正在处理，请稍后再试');
    const used = db.prepare('SELECT count(*) AS n FROM ai_usage WHERE user_id=? AND created>=?').get(user.id, now().slice(0, 10)).n;
    if (used >= dailyLimit) fail(429, `今天已达到 ${dailyLimit} 次 AI 调用上限`);
    const connection = new AbortController();
    const signal = AbortSignal.any([connection.signal, AbortSignal.timeout(90000)]);
    const disconnect = () => connection.abort();
    res.once('close', disconnect);
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
    res.flushHeaders();
    res.write(`data: ${JSON.stringify({ status: 'connecting' })}\n\n`);
    const heartbeat = setInterval(() => { if (!res.destroyed) res.write(': heartbeat\n\n'); }, 10000);
    try {
      for (const config of candidates) {
        signal.throwIfAborted();
        const usageId = id();
        db.prepare('INSERT INTO ai_usage VALUES (?,?,?,?,?)').run(usageId, user.id, config.id, now(), 'pending');
        activeCalls.set(user.id, (activeCalls.get(user.id) || 0) + 1); totalCalls++;
        let streamed = false;
        let reasoningStartedAt = null;
        let firstTokenMs = null;
        let thinkingMs = null;
        try {
          const answer = await streamModel({ ...config, apiKey: decrypt(config.key) }, messages, available, token => {
            signal.throwIfAborted();
            if (!streamed) {
              firstTokenMs = Math.round(performance.now() - startedAt);
              if (reasoningStartedAt !== null) thinkingMs = Math.round(performance.now() - reasoningStartedAt);
              res.write(`data: ${JSON.stringify({ status: 'answering', timing: { firstTokenMs, thinkingMs } })}\n\n`);
            }
            streamed = true;
            res.write(`data: ${JSON.stringify({ token })}\n\n`);
          }, { signal, onReasoning: () => {
            signal.throwIfAborted();
            reasoningStartedAt = performance.now();
            res.write(`data: ${JSON.stringify({ status: 'thinking' })}\n\n`);
          } });
          signal.throwIfAborted();
          db.prepare('UPDATE ai_usage SET status=? WHERE id=?').run('success', usageId);
          modelRetryAfter.delete(config.id);
          return { answer, model: '小研AI', timing: { firstTokenMs, thinkingMs, totalMs: Math.round(performance.now() - startedAt) } };
        } catch (error) {
          db.prepare('UPDATE ai_usage SET status=? WHERE id=?').run('failed', usageId);
          if (signal.aborted) throw error;
          modelRetryAfter.set(config.id, Date.now() + 60000);
          if (streamed) throw error;
          if (config !== candidates.at(-1)) res.write(`data: ${JSON.stringify({ status: 'switching' })}\n\n`);
        } finally { totalCalls--; activeCalls.set(user.id, activeCalls.get(user.id) - 1); }
      }
      fail(503, '小研AI当前免费模型暂不可用，请稍后重试。');
    } finally {
      clearInterval(heartbeat);
      res.off('close', disconnect);
    }
  }
  async function body(req) {
    if (!req.headers['content-type']?.startsWith('application/json')) fail(415, '请使用 JSON 请求');
    const chunks = [];
    let length = 0;
    for await (const chunk of req) { length += chunk.length; if (length > 1024 * 1024) fail(413, '提交内容过大'); chunks.push(chunk); }
    let result;
    try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail(400, 'JSON 格式不正确'); }
    if (!result || typeof result !== 'object' || Array.isArray(result)) fail(400, '请求必须为 JSON 对象');
    return result;
  }
  async function api(req, res, pathname) {
    const method = req.method;
    const ip = req.socket.remoteAddress || 'unknown';
    limit(`api:${ip}`, 500);
    if (method !== 'GET') {
      const expected = origin || `http://${req.headers.host}`;
      if (req.headers.origin !== expected || req.headers['sec-fetch-site'] === 'cross-site') fail(403, '请求来源不匹配，请通过本站网页操作');
    }
    if (pathname === '/api/health' && method === 'GET') return { app: 'qiyan-lab', version: '1.7.37' };
    if (pathname === '/api/auth/status' && method === 'GET') return { needsSetup: !db.prepare('SELECT id FROM users LIMIT 1').get(), user: userFrom(req) ? publicUser(userFrom(req)) : null };
    if (['/api/auth/setup', '/api/auth/register', '/api/auth/login'].includes(pathname) && method === 'POST') {
      limit(`auth:${ip}`, 20, 15 * 60000);
      const input = await body(req);
      const address = email(input.email);
      limit(`email:${address}`, 20, 15 * 60000);
      if (pathname.endsWith('/login')) {
        const user = db.prepare('SELECT * FROM users WHERE email=?').get(address);
        const match = await hashWork(() => passwordMatches(input.password, user?.password || dummyPassword));
        if (!user?.active || !match) fail(401, '邮箱或密码不正确');
        session(res, user);
        return { user: publicUser(user) };
      }
      const name = text(input.name, '姓名', 60);
      const password = await hashWork(() => passwordHash(input.password));
      const user = transaction(() => {
        let role;
        if (pathname.endsWith('/setup')) {
          if (db.prepare('SELECT id FROM users LIMIT 1').get()) fail(409, '管理员已创建，请登录');
          if (!setupToken || hash(text(input.token, '初始化口令', 100)) !== hash(setupToken)) fail(403, '初始化口令不正确，请查看服务器 data/setup-token.txt');
          role = 'admin';
        } else {
          const token = hash(text(input.token, '邀请码', 100));
          const invite = db.prepare('SELECT * FROM invites WHERE token=? AND expires>? AND used=0').get(token, Date.now());
          if (!invite) fail(403, '邀请码无效、已使用或已过期');
          role = invite.role;
          db.prepare('UPDATE invites SET used=1 WHERE token=?').run(token);
        }
        if (db.prepare('SELECT id FROM users WHERE email=?').get(address)) fail(409, '此邮箱已注册');
        const userId = id();
        db.prepare('INSERT INTO users(id,email,name,password,role,created) VALUES (?,?,?,?,?,?)').run(userId, address, name, password, role, now());
        return db.prepare('SELECT * FROM users WHERE id=?').get(userId);
      });
      session(res, user);
      return { user: publicUser(user) };
    }
    const user = userFrom(req);
    if (!user) fail(401, '请先登录');
    const avatarMatch = /^\/api\/avatars\/([a-f0-9-]{36})$/.exec(pathname);
    if (avatarMatch && method === 'GET') {
      const avatar = db.prepare('SELECT image FROM user_avatars WHERE user_id=?').get(avatarMatch[1]);
      if (!avatar) fail(404, '头像不存在');
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': avatar.image.length });
      res.end(Buffer.from(avatar.image)); return;
    }
    if (pathname === '/api/avatar' && method === 'PUT') {
      limit(`avatar:${user.id}`, 10, 60000);
      if (req.headers['content-type'] !== 'image/jpeg') fail(415, '请使用 JPEG 头像');
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 256 * 1024) fail(413, '头像过大'); chunks.push(chunk); }
      const image = Buffer.concat(chunks);
      if (image.length < 16 || image[0] !== 255 || image[1] !== 216 || image[2] !== 255 || image.at(-2) !== 255 || image.at(-1) !== 217) fail(400, '头像图片格式不正确');
      db.prepare('INSERT INTO user_avatars VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET image=excluded.image,version=excluded.version').run(user.id, image, hash(image).slice(0, 16));
      return { ok: true };
    }
    if (pathname === '/api/avatar' && method === 'DELETE') { db.prepare('DELETE FROM user_avatars WHERE user_id=?').run(user.id); return { ok: true }; }
    if (pathname === '/api/files' && method === 'POST') return files.upload(req, user, () => userFrom(req));
    if (pathname === '/api/mailbox' && method === 'GET') {
      admin(user);
      const config = db.prepare('SELECT email,enabled,updated FROM mailbox_settings WHERE id=1').get();
      const progress = db.prepare('SELECT last_checked,last_error FROM mailbox_settings WHERE id=1').get();
      return { mailbox: config ? { ...config, ...progress, enabled: Boolean(config.enabled), configured: true } : { email: 'your-email@example.com', enabled: false, configured: false, last_checked: '', last_error: '' } };
    }
    if (pathname === '/api/mailbox' && method === 'PUT') {
      admin(user);
      limit(`mailbox:${user.id}`, 5, 60000);
      const input = await body(req);
      const address = email(input.email);
      if (!address.endsWith('@163.com')) fail(400, '目前仅支持 163 邮箱');
      const secret = text(input.appPassword, '客户端授权码', 200);
      let lastUid;
      try { lastUid = await checkMailbox(address, secret); }
      catch (error) { fail(400, error.message); }
      const existingMailbox = db.prepare('SELECT email,last_uid FROM mailbox_settings WHERE id=1').get();
      if (existingMailbox?.email === address) lastUid = existingMailbox.last_uid;
      if (existingMailbox && existingMailbox.email !== address) db.prepare('DELETE FROM mailbox_messages').run();
      db.prepare(`INSERT INTO mailbox_settings(id,email,secret,enabled,updated,last_uid) VALUES (1,?,?,1,?,?)
        ON CONFLICT(id) DO UPDATE SET email=excluded.email,secret=excluded.secret,enabled=1,updated=excluded.updated,last_uid=excluded.last_uid,last_error=''`)
        .run(address, encrypt(secret), now(), lastUid);
      setTimeout(() => { pollMailbox(); }, 1000).unref();
      return { ok: true };
    }
    if (pathname === '/api/mailbox' && method === 'DELETE') {
      admin(user);
      db.prepare('DELETE FROM mailbox_settings WHERE id=1').run();
      return { ok: true };
    }
    if (pathname === '/api/mailbox/check' && method === 'POST') {
      admin(user);
      limit(`mailbox-check:${user.id}`, 4, 60000);
      return await pollMailbox();
    }
    const mailDetailMatch = /^\/api\/mailbox\/messages\/([\w-]+)$/.exec(pathname);
    if (mailDetailMatch && method === 'GET') {
      admin(user);
      limit(`mail-read:${user.id}`, 15);
      if (readingMail >= 2) fail(429, '正在读取邮件，请稍后重试');
      const message = db.prepare('SELECT uid,message_id FROM mailbox_messages WHERE id=?').get(mailDetailMatch[1]);
      if (!message) fail(404, '邮件记录不存在');
      const config = db.prepare('SELECT email,secret FROM mailbox_settings WHERE id=1').get();
      if (!config) fail(400, '请先配置投稿邮箱');
      readingMail++;
      try {
        return { message: await readMailboxMessage(config.email, decrypt(config.secret), message.uid, message.message_id) };
      } catch (error) { fail(502, error.message || '邮件读取失败，请到网易邮箱查看'); }
      finally { readingMail--; }
    }
    if (pathname === '/api/mailbox/journals' && method === 'GET') {
      const journals = new Map();
      for (const row of db.prepare("SELECT id,journal,status,subject,received,decision,review_default FROM mailbox_messages WHERE decision<>'ignored' ORDER BY received DESC,created DESC,id DESC").all()) {
        const key = journalKey(row.journal) || row.id;
        if (!journals.has(key)) journals.set(key, { id: hash(key).slice(0, 24), journal: row.journal || '待识别期刊', status: '', received: '', reviewFallback: false, stageMail: {}, messages: [] });
        const journal = journals.get(key);
        if (row.decision === 'applied' && ['submitted', 'under_review', 'revision', 'accepted', 'published'].includes(row.status)) {
          journal.stageMail[row.status] ||= { id: row.id };
          if (!journal.status) {
            journal.status = row.status; journal.received = row.received; journal.reviewFallback = Boolean(row.review_default);
          } else if (journal.reviewFallback && !row.review_default) {
            if (['revision', 'accepted', 'published'].includes(row.status)) { journal.status = row.status; journal.received = row.received; }
            journal.reviewFallback = false;
          }
        }
        if (journal.messages.length < 5) journal.messages.push({ id: row.id, subject: row.subject, received: row.received, status: row.status, updated: row.decision === 'applied', reviewDefault: Boolean(row.review_default) });
      }
      const config = db.prepare('SELECT enabled,last_checked,last_error FROM mailbox_settings WHERE id=1').get();
      return { journals: [...journals.values()], mailbox: { enabled: Boolean(config?.enabled), last_checked: config?.last_checked || '', last_error: config?.last_error || '' } };
    }
    const photoMatch = /^\/api\/files\/([a-f0-9-]{36})\/preview$/.exec(pathname);
    if (photoMatch && method === 'GET') { await files.preview(photoMatch[1], res, user, new URL(req.url, 'http://localhost').searchParams.get('size') === 'thumb'); return; }
    const fileMatch = /^\/api\/files\/([a-f0-9-]{36})$/.exec(pathname);
    if (fileMatch && method === 'GET') { await files.download(fileMatch[1], res, user); return; }
    if (fileMatch && method === 'DELETE') return files.remove(fileMatch[1], user);
    if (pathname === '/api/auth/logout' && method === 'POST') {
      db.prepare('DELETE FROM sessions WHERE token=?').run(hash(tokenFrom(req)));
      res.setHeader('Set-Cookie', `qiyan_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`);
      return { ok: true };
    }
    if (pathname === '/api/auth/password' && method === 'POST') {
      limit(`password:${user.id}`, 5, 15 * 60000);
      const input = await body(req);
      if (!await hashWork(() => passwordMatches(input.current, user.password))) fail(403, '当前密码不正确');
      const password = await hashWork(() => passwordHash(input.password));
      transaction(() => { db.prepare('UPDATE users SET password=? WHERE id=?').run(password, user.id); db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id); });
      session(res, user);
      return { ok: true };
    }
    if (pathname === '/api/state' && method === 'GET') {
      const data = Object.fromEntries(kinds.map(kind => [kind, db.prepare('SELECT * FROM records WHERE kind=? ORDER BY created DESC,id').all(kind).map(publicRecord)]));
      data.members = db.prepare('SELECT u.*,a.version AS avatar_version FROM users u LEFT JOIN user_avatars a ON a.user_id=u.id WHERE u.active=1 ORDER BY u.created').all().map(x => ({ ...publicUser(x), initial: x.name[0] }));
      data.files = files.list(user);
      const preference = db.prepare('SELECT body,version FROM dashboard_preferences WHERE user_id=?').get(user.id);
      return { data, user: publicUser(user), storage: files.state(), dashboard: preference ? { settings: JSON.parse(preference.body), version: preference.version } : { settings: null, version: 0 } };
    }
    if (pathname === '/api/group-chat' && method === 'GET') {
      return { messages: db.prepare('SELECT m.seq,m.owner,m.body,m.created,u.name,a.version AS avatar_version FROM (SELECT * FROM group_messages ORDER BY seq DESC LIMIT 100) m JOIN users u ON u.id=m.owner LEFT JOIN user_avatars a ON a.user_id=u.id ORDER BY m.seq').all().map(({ avatar_version, ...message }) => ({ ...message, avatar: avatarUrl(message.owner, avatar_version) })) };
    }
    if (pathname === '/api/group-chat' && method === 'POST') {
      limit(`group-chat:${user.id}`, 15, 60000);
      const input = await body(req);
      const message = text(input.message, '消息', 2000);
      const clientId = text(input.clientId, '消息标识', 36);
      if (!/^[a-f0-9-]{36}$/.test(clientId)) fail(400, '消息标识不正确');
      const existing = db.prepare('SELECT body FROM group_messages WHERE owner=? AND client_id=?').get(user.id, clientId);
      if (existing && existing.body !== message) fail(409, '消息内容已更改，请重新发送');
      if (!existing) db.prepare('INSERT INTO group_messages (owner,body,created,client_id) VALUES (?,?,?,?)').run(user.id, message, now(), clientId);
      return { ok: true };
    }
    if (pathname === '/api/dashboard' && method === 'PUT') {
      const input = await body(req);
      const settings = dashboardInput(input.settings);
      if (!Number.isSafeInteger(input.version) || input.version < 0) fail(400, '工作台版本不正确');
      return transaction(() => {
        const existing = db.prepare('SELECT version FROM dashboard_preferences WHERE user_id=?').get(user.id);
        if ((existing?.version || 0) !== input.version) fail(409, '工作台已在另一窗口更新，请取消编辑后重新调整');
        const version = input.version + 1;
        db.prepare('INSERT INTO dashboard_preferences(user_id,body,version) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET body=excluded.body,version=excluded.version').run(user.id, JSON.stringify(settings), version);
        return { settings, version };
      });
    }
    if (pathname === '/api/users' && method === 'GET') { admin(user); return { users: db.prepare('SELECT * FROM users ORDER BY created').all().map(publicUser) }; }
    if (pathname === '/api/invites' && method === 'POST') {
      admin(user);
      const input = await body(req);
      if (!['advisor', 'student'].includes(input.role)) fail(400, '请选择导师或学生角色');
      const token = randomBytes(24).toString('hex');
      const expires = Date.now() + 7 * 86400000;
      db.prepare('INSERT INTO invites VALUES (?,?,?,0)').run(hash(token), input.role, expires);
      return { token, expires };
    }
    const memberMatch = /^\/api\/users\/([\w-]+)$/.exec(pathname);
    if (memberMatch && method === 'PATCH') {
      admin(user);
      const input = await body(req);
      const target = db.prepare('SELECT * FROM users WHERE id=?').get(memberMatch[1]);
      if (!target) fail(404, '成员不存在');
      const role = input.role ?? target.role;
      const active = input.active ?? Boolean(target.active);
      if (!['admin', 'advisor', 'student'].includes(role) || typeof active !== 'boolean') fail(400, '成员设置不正确');
      if (target.role === 'admin' && target.active && (role !== 'admin' || !active) && db.prepare("SELECT count(*) AS n FROM users WHERE role='admin' AND active=1").get().n <= 1) fail(400, '至少保留一位启用的管理员');
      db.prepare('UPDATE users SET role=?,active=? WHERE id=?').run(role, Number(active), target.id);
      if (!active) db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);
      return { ok: true };
    }
    if (pathname === '/api/import' && method === 'POST') {
      admin(user);
      const input = await body(req);
      const entries = [];
      for (const kind of kinds) {
        if (!Array.isArray(input[kind] ?? [])) fail(400, '导入内容必须是记录数组');
        for (const value of input[kind] || []) entries.push([kind, recordInput(kind, value)]);
      }
      if (!entries.length || entries.length > 1000) fail(400, '每次可导入 1–1000 条记录');
      transaction(() => { for (const [kind, value] of entries) db.prepare('INSERT INTO records VALUES (?,?,?,?,1,?)').run(id(), kind, user.id, JSON.stringify(value), now()); });
      return { count: entries.length };
    }
    const recordMatch = /^\/api\/records\/([a-z]+)(?:\/([\w-]+))?$/.exec(pathname);
    if (recordMatch) {
      const [, kind, recordId] = recordMatch;
      if (!kinds.includes(kind)) fail(404, '记录类型不存在');
      if (!recordId && method === 'POST') {
        const value = recordInput(kind, await body(req));
        const recordId = id();
        db.prepare('INSERT INTO records VALUES (?,?,?,?,1,?)').run(recordId, kind, user.id, JSON.stringify(value), now());
        return { record: publicRecord(db.prepare('SELECT * FROM records WHERE id=?').get(recordId)) };
      }
      if (recordId && ['PATCH', 'DELETE'].includes(method)) {
        const input = await body(req);
        const record = db.prepare('SELECT * FROM records WHERE id=? AND kind=?').get(recordId, kind);
        if (!record) fail(404, '记录不存在或已删除');
        canModify(user, record);
        if (input.version !== record.version) fail(409, '记录已被其他成员更新，请刷新后重新操作');
        if (method === 'DELETE') db.prepare('DELETE FROM records WHERE id=? AND version=?').run(recordId, input.version);
        else {
          const value = recordInput(kind, { ...publicRecord(record), ...input });
          db.prepare('UPDATE records SET body=?,version=version+1 WHERE id=? AND version=?').run(JSON.stringify(value), recordId, input.version);
        }
        return { ok: true };
      }
    }
    if (pathname === '/api/ai/gateway') {
      admin(user);
      if (!gateway) return method === 'GET' ? { connected: false, configured: false, models: [], notice: '当前环境尚未安装 FreeLLMAPI。' } : fail(503, '当前环境尚未安装 FreeLLMAPI');
      if (method === 'GET') return gateway.status();
      if (method === 'POST' || method === 'DELETE') {
        if (gatewaySaving) fail(409, '模型配置正在保存，请稍后再试');
        gatewaySaving = true;
        try {
          if (method === 'DELETE') {
            await gateway.disconnect();
            db.prepare("DELETE FROM configs WHERE provider='freellmapi'").run();
            return { ok: true };
          }
          const input = await body(req);
          const existing = db.prepare("SELECT id FROM configs WHERE provider='freellmapi' AND model=? AND scope='global'").get(String(input.model || ''));
          if (!existing && db.prepare("SELECT count(*) AS n FROM configs WHERE provider='freellmapi'").get().n >= 30) fail(400, '最多添加 30 个免费模型');
          const saved = await gateway.save(input);
          if (existing) db.prepare('UPDATE configs SET key=?,enabled=1 WHERE id=?').run(encrypt(saved.apiKey), existing.id);
          else db.prepare('INSERT INTO configs VALUES (?,?,?,?,?,?,?,?,1)').run(id(), user.id, 'global', 'freellmapi', saved.label, saved.model, gatewayBase, encrypt(saved.apiKey));
          return { ok: true };
        } finally { gatewaySaving = false; }
      }
    }
    if (pathname === '/api/ai/providers' && method === 'GET') return { providers: available.filter(x => x.id !== 'freellmapi').map(({ protocol, ...x }) => x), dailyLimit };
    if (pathname === '/api/ai/configs' && method === 'GET') {
      const configs = db.prepare("SELECT * FROM configs WHERE provider!='freellmapi' AND (scope='global' OR owner=?) ORDER BY scope,label").all(user.id).map(publicConfig);
      const hasXiaoyan = Boolean(db.prepare("SELECT 1 FROM configs WHERE provider='freellmapi' AND scope='global' AND enabled=1 LIMIT 1").get());
      if (hasXiaoyan) configs.unshift({ id: 'xiaoyan-auto', scope: 'global', provider: 'xiaoyan', label: '小研AI（自动调度）', model: '', base: '', enabled: true, hasKey: false });
      return { configs };
    }
    if (pathname === '/api/ai/configs' && method === 'POST') {
      const input = configInput(await body(req), available);
      if (input.provider === 'freellmapi') fail(400, '请通过免费模型接入面板配置');
      if (input.scope === 'global') admin(user);
      if (!input.apiKey) fail(400, '请输入 API Key');
      if (db.prepare('SELECT count(*) AS n FROM configs WHERE owner=?').get(user.id).n >= 30) fail(400, '每人最多保存 30 个模型配置');
      const configId = id();
      db.prepare('INSERT INTO configs VALUES (?,?,?,?,?,?,?,?,1)').run(configId, user.id, input.scope, input.provider, input.label, input.model, input.base, encrypt(input.apiKey));
      return { config: publicConfig(db.prepare('SELECT * FROM configs WHERE id=?').get(configId)) };
    }
    const configMatch = /^\/api\/ai\/configs\/([\w-]+)(?:\/(test))?$/.exec(pathname);
    if (configMatch) {
      const config = getConfig(configMatch[1], user, true);
      if (configMatch[2] === 'test' && method === 'POST') {
        const answer = await generate(user, config, [{ role: 'user', content: 'Reply with OK only.' }]);
        return { ok: true, message: answer.slice(0, 100) };
      }
      if (!configMatch[2] && method === 'PATCH') {
        const input = await body(req);
        if (config.provider === 'freellmapi') {
          if (Object.keys(input).length !== 1 || typeof input.enabled !== 'boolean') fail(400, '请通过免费模型接入面板修改模型');
          db.prepare('UPDATE configs SET enabled=? WHERE id=?').run(Number(input.enabled), config.id);
          return { ok: true };
        }
        if (input.provider === 'freellmapi') fail(400, '请通过免费模型接入面板配置');
        const updated = configInput({ ...config, ...input }, available);
        if (updated.scope === 'global') admin(user);
        if (updated.scope !== config.scope) fail(400, '配置范围不能修改，请新建配置');
        if (input.enabled !== undefined && typeof input.enabled !== 'boolean') fail(400, '启用状态不正确');
        db.prepare('UPDATE configs SET provider=?,label=?,model=?,base=?,key=?,enabled=? WHERE id=?').run(updated.provider, updated.label, updated.model, updated.base, updated.apiKey ? encrypt(updated.apiKey) : config.key, input.enabled === undefined ? config.enabled : Number(input.enabled), config.id);
        return { ok: true };
      }
      if (!configMatch[2] && method === 'DELETE') { db.prepare('DELETE FROM configs WHERE id=?').run(config.id); return { ok: true }; }
    }
    if (pathname === '/api/chat-documents' && method === 'POST') { limit(`chat-document:${user.id}`, 20); return readChatDocument(req, user.id); }
    if (pathname === '/api/chat-projects' && method === 'GET') return { projects: db.prepare('SELECT id,name FROM chat_projects WHERE owner=? ORDER BY created').all(user.id) };
    if (pathname === '/api/chat-projects' && method === 'POST') {
      const input = await body(req);
      const name = text(input.name, '项目名称', 60);
      if (db.prepare('SELECT count(*) AS n FROM chat_projects WHERE owner=?').get(user.id).n >= 50) fail(400, '最多创建 50 个项目');
      const projectId = id();
      db.prepare('INSERT INTO chat_projects VALUES (?,?,?,?)').run(projectId, user.id, name, now());
      return { project: { id: projectId, name } };
    }
    const projectMatch = /^\/api\/chat-projects\/([\w-]+)$/.exec(pathname);
    if (projectMatch) {
      const project = db.prepare('SELECT * FROM chat_projects WHERE id=? AND owner=?').get(projectMatch[1], user.id);
      if (!project) fail(404, '项目不存在');
      if (method === 'PUT') {
        const input = await body(req);
        db.prepare('UPDATE chat_projects SET name=? WHERE id=? AND owner=?').run(text(input.name, '项目名称', 60), project.id, user.id);
        return { ok: true };
      }
      if (method === 'DELETE') {
        db.prepare('DELETE FROM chat_projects WHERE id=? AND owner=?').run(project.id, user.id);
        return { ok: true };
      }
    }
    if (pathname === '/api/chats' && method === 'GET') return { chats: db.prepare("SELECT c.id,c.title,c.updated,COALESCE(l.project_id,'') AS project_id FROM chats c LEFT JOIN chat_project_links l ON l.chat_id=c.id WHERE c.owner=? ORDER BY c.updated DESC").all(user.id) };
    if (pathname === '/api/chats' && method === 'POST') {
      if (db.prepare('SELECT count(*) AS n FROM chats WHERE owner=?').get(user.id).n >= 200) fail(400, '最多保存 200 个对话，请先删除旧对话');
      const input = await body(req);
      const projectId = text(input.projectId ?? '', '项目', 80, false);
      if (projectId && !db.prepare('SELECT id FROM chat_projects WHERE id=? AND owner=?').get(projectId, user.id)) fail(404, '项目不存在');
      const chatId = id();
      transaction(() => {
        db.prepare('INSERT INTO chats VALUES (?,?,?,?,?)').run(chatId, user.id, '新对话', '[]', now());
        if (projectId) db.prepare('INSERT INTO chat_project_links VALUES (?,?)').run(chatId, projectId);
      });
      return { chat: getChat(chatId, user) };
    }
    const chatMatch = /^\/api\/chats\/([\w-]+)(?:\/(messages))?$/.exec(pathname);
    if (chatMatch) {
      const chat = getChat(chatMatch[1], user);
      if (!chatMatch[2] && method === 'GET') return { chat };
      if (pendingChats.has(chat.id)) fail(409, '此对话正在生成回复，请稍后操作');
      if (!chatMatch[2] && method === 'PATCH') {
        const input = await body(req);
        if (pendingChats.has(chat.id)) fail(409, '此对话正在生成回复，请稍后操作');
        const projectId = text(input.projectId ?? '', '项目', 80, false);
        if (projectId && !db.prepare('SELECT id FROM chat_projects WHERE id=? AND owner=?').get(projectId, user.id)) fail(404, '项目不存在');
        transaction(() => {
          db.prepare('DELETE FROM chat_project_links WHERE chat_id=?').run(chat.id);
          if (projectId) db.prepare('INSERT INTO chat_project_links VALUES (?,?)').run(chat.id, projectId);
        });
        return { chat: getChat(chat.id, user) };
      }
      if (!chatMatch[2] && method === 'DELETE') { db.prepare('DELETE FROM chats WHERE id=? AND owner=?').run(chat.id, user.id); return { ok: true }; }
      if (chatMatch[2] === 'messages' && method === 'POST') {
        const input = await body(req);
        // Recheck after reading the asynchronous request body to prevent concurrent turns.
        if (pendingChats.has(chat.id)) fail(409, '此对话正在生成回复，请稍后操作');
        const fresh = getChat(chat.id, user);
        if (fresh.messages.length >= 100) fail(400, '此对话已达 50 轮，请开启新对话');
        const turn = chatUserTurn(input);
        const content = turn.content;
        const config = getConfig(text(input.configId, '模型配置', 80), user);
        pendingChats.add(chat.id);
        try {
          const messages = [...fresh.messages.slice(-18), turn].map(chatModelMessage);
          if (config.id === 'xiaoyan-auto' && req.headers.accept?.includes('text/event-stream')) {
            try {
              const { answer, model, timing } = await generateAutomaticStream(user, messages, res);
              const next = [...fresh.messages, turn, { role: 'assistant', content: answer, model, timing }];
              const title = fresh.messages.length ? fresh.title : content.slice(0, 36);
              const updated = now();
              db.prepare('UPDATE chats SET title=?,messages=?,updated=? WHERE id=?').run(title, JSON.stringify(next), updated, chat.id);
              const result = req.headers['x-chat-stream-version'] === '2' ? { id: chat.id, title, updated, project_id: fresh.project_id } : getChat(chat.id, user);
              res.write(`data: ${JSON.stringify({ done: true, chat: result, timing })}\n\n`); res.end();
            } catch (error) {
              if (!res.headersSent) throw error;
              if (!res.destroyed) res.end(`data: ${JSON.stringify({ error: error.status ? error.message : '回复连接中断，请稍后重试。' })}\n\n`);
            }
            return;
          }
          const startedAt = performance.now();
          const answer = config.id === 'xiaoyan-auto' ? await generateAutomatic(user, messages) : await generate(user, config, messages);
          const next = [...fresh.messages, turn, { role: 'assistant', content: answer, model: config.id === 'xiaoyan-auto' ? '小研AI' : config.label, timing: { totalMs: Math.round(performance.now() - startedAt) } }];
          db.prepare('UPDATE chats SET title=?,messages=?,updated=? WHERE id=?').run(fresh.messages.length ? fresh.title : content.slice(0, 36), JSON.stringify(next), now(), chat.id);
          return { chat: getChat(chat.id, user) };
        } finally { pendingChats.delete(chat.id); }
      }
    }
    fail(404, '接口不存在');
  }
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (pathname.startsWith('/api/')) {
        const result = await api(req, res, pathname);
        if (res.headersSent || res.writableEnded) return;
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(result));
        return;
      }
      const asset = publicFiles.get(pathname);
      if (!asset || !['GET', 'HEAD'].includes(req.method)) fail(404, '页面不存在');
      const bytes = await readFile(join(root, asset[0]));
      res.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8` });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      res.writeHead(error.status || 500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: error.status ? error.message : '服务器处理失败，请稍后重试' }));
      if (!error.status) console.error('Request failed:', error.code || error.name);
    }
  });
  server.requestTimeout = 300000;
  server.headersTimeout = 15000;
  server.on('close', () => { clearInterval(timer); clearInterval(mailboxTimer); db.close(); });
  return { server, db, setupToken };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await createApplication();
  const host = process.env.HOST || '0.0.0.0';
  const port = Number(process.env.PORT || 3210);
  app.server.on('error', error => { console.error(`启动失败：${error.code === 'EADDRINUSE' ? '端口已被占用，请检查是否已经启动，或修改 PORT' : error.message}`); process.exit(1); });
  app.server.listen(port, host, () => {
    console.log(`爱小研已启动：http://localhost:${port}`);
    if (host === '0.0.0.0') for (const entries of Object.values(networkInterfaces())) for (const entry of entries || []) if (entry.family === 'IPv4' && !entry.internal) console.log(`局域网访问：http://${entry.address}:${port}`);
    if (!app.db.prepare('SELECT id FROM users LIMIT 1').get()) console.log('首次使用：初始化口令在 data/setup-token.txt 文件中。');
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { app.server.close(); app.server.closeIdleConnections(); });
}

