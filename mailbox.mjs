import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

const MAX_MESSAGE_BYTES = 512 * 1024;
const MAX_PER_SCAN = 30;

export const journalKey = value => String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

export function detectJournal(subject, body = '', known = []) {
  const content = `${subject}\n${body}`.slice(0, 14000);
  const normalized = journalKey(content);
  const matches = [...new Set(known.filter(name => journalKey(name).length >= 5 && normalized.includes(journalKey(name))))];
  if (matches.length === 1) return matches[0];
  if (/\banimal behaviour\b|\bANBEH-D-|editorialmanager\.com\/anbeh\b/i.test(content)) return 'Animal Behaviour';
  if (/\bjournal of hazardous materials\b/i.test(content)) return 'Journal of Hazardous Materials';
  const patterns = [/(?:journal(?: name| title)?|期刊(?:名称)?)\s*[:：]\s*([^\r\n]+)/i, /(?:submission to|submitted to|submitting to|editors at|editors of|editorial office of)\s+([^\r\n]+)/i];
  for (const pattern of patterns) {
    const match = pattern.exec(content);
    const name = match?.[1].replace(/\s*\[[^\]]*\].*$/, '').replace(/^[\s"'“”]+|[\s."'“”]+$/g, '').trim();
    if (name && name.length >= 3 && name.length <= 160 && !/[<>@]|https?:\/\//i.test(name)) return name;
  }
  return '';
}

function clientFor(email, secret) {
  if (!/^[^\s@]+@163\.com$/i.test(email) || typeof secret !== 'string' || !secret.trim()) {
    throw new Error('请填写有效的 163 邮箱地址和客户端授权码');
  }
  return new ImapFlow({ host: 'imap.163.com', port: 993, secure: true, auth: { user: email, pass: secret }, logger: false, socketTimeout: 20000 });
}

async function inInbox(email, secret, fn) {
  const client = clientFor(email, secret);
  let lock;
  let connected = false;
  try {
    await client.connect();
    connected = true;
    lock = await client.getMailboxLock('INBOX', { readOnly: true });
    return await fn(client);
  } finally {
    lock?.release();
    if (connected) await client.logout().catch(() => client.close());
    else client.close();
  }
}

async function latestUid(client) {
  const next = Number(client.mailbox.uidNext);
  if (Number.isSafeInteger(next) && next > 0) return next - 1;
  const count = Number(client.mailbox.exists);
  if (count === 0) return 0;
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('无法读取收件箱数量');
  const latest = await client.fetchOne(String(count), { uid: true });
  if (!Number.isSafeInteger(latest?.uid) || latest.uid < 1) throw new Error('无法读取最新邮件编号');
  return latest.uid;
}

export function checkMailbox(email, secret) {
  return inInbox(email, secret, latestUid);
}

export function readMailboxMessage(email, secret, uid, expectedMessageId = '') {
  return inInbox(email, secret, async client => {
    const meta = await client.fetchOne(String(uid), { uid: true, size: true, envelope: true }, { uid: true });
    if (!meta) throw new Error('此邮件已移动或删除，请到网易邮箱查看');
    const maxBytes = 2 * 1024 * 1024;
    const raw = await client.fetchOne(String(uid), { source: { maxLength: maxBytes } }, { uid: true });
    if (!raw?.source) throw new Error('无法读取原邮件，请到网易邮箱查看');
    const parsed = await simpleParser(raw.source, { maxHtmlLengthToParse: maxBytes, maxTextLengthToParse: maxBytes });
    const messageId = parsed.messageId || meta.envelope?.messageId || '';
    if (expectedMessageId && messageId !== expectedMessageId) throw new Error('邮件编号已变化，请到网易邮箱查看');
    const content = parsed.text || '';
    return { subject: String(parsed.subject || meta.envelope?.subject || '(无主题)').slice(0, 500), sender: String(parsed.from?.text || '').slice(0, 500), received: parsed.date?.toISOString() || '', text: content.slice(0, 200000), truncated: meta.size > maxBytes || content.length > 200000 };
  });
}

export const authorConfirmation = value => /\bco-?authorship\b|\bconfirm (?:your )?authorship\b|作者身份确认/i.test(value);
const explicitReview = value => /\bunder review\b|\bwith (?:the )?editor\b|\b(?:sent|submitted|assigned) for (?:peer )?review\b|已送审|送审中|外审中/i.test(value);
export const isDefaultReview = (subject, body = '') => authorConfirmation(subject) || !explicitReview(`${subject}\n${body}`);

export function classifyStatus(subject, body = '') {
  const title = subject.toLocaleLowerCase();
  const content = body.toLocaleLowerCase().slice(0, 12000);
  if (/\binvitation to review\b|\breview invitation\b|\bnewsletter\b|\bwebinar\b|\bmentorship\b|\bcall for papers\b|审稿邀请|征稿|研讨会/.test(title)) return '';
  if (authorConfirmation(title)) return 'under_review';
  // A revision receipt means resubmitted, rather than a new request for revision.
  if (/\bsubmission of (?:a )?revision\b|\brevision (?:received|submitted)\b|修回(?:已提交|成功)|已收到修回/.test(title)) return 'submitted';
  if (/\b(?:rejected|declined|not accepted)\b|拒稿|不予录用/.test(title)) return '';
  if (/\bpublished online\b|\bnow published\b|\byour article is now (?:available )?online\b|已发表|已出版/.test(title)) return 'published';
  if (/^acceptance\b|\b(?:manuscript|paper|article|submission)[^\n.!?]{0,100}\baccepted\b|\baccepted for publication\b|(?:稿件|论文).{0,20}(?:录用|接收)|录用通知|接收通知/.test(title)) return 'accepted';
  if (/\b(?:major|minor) revisions?\b|\brevise and resubmit\b|\brevision (?:required|requested)\b|大修|小修|返修/.test(title)) return 'revision';
  if (/\b(?:submission|manuscript) received\b|\bsubmitted successfully\b|投稿成功|已收稿/.test(title)) return 'submitted';
  if (/\bthank you for submitting (?:a |your )?(?:revision|revised manuscript)\b/.test(content)) return 'submitted';
  if (/\b(?:your|the) (?:article|paper|manuscript) (?:is |has been )?(?:now )?published online\b|您的(?:论文|文章)已(?:发表|出版)/.test(content)) return 'published';
  if (/\b(?:your|the) (?:revised )?(?:manuscript|paper|article|submission)[^\n.!?]{0,100}\b(?:has been|is|was) (?:formally )?accepted\b|\b(?:pleased|happy) to (?:inform[^\n.!?]{0,100}accept|accept)\b|您的(?:稿件|论文)已(?:被)?(?:接收|录用)/.test(content)) return 'accepted';
  if (/\b(?:your|the) (?:manuscript|paper|article)[^\n.!?]{0,100}\b(?:has been|is|was) (?:rejected|declined)\b|决定拒稿|不予录用/.test(content)) return '';
  if (/\b(?:major|minor) revisions?\b|\brevise and resubmit\b|\b(?:invite|request|ask)[^\n.!?]{0,100}\b(?:revise|revision)\b|请(?:对稿件)?修改|建议(?:大修|小修)|返修/.test(content)) return 'revision';
  if (/\bthank you for (?:submitting|your submission)\b|\b(?:submission|manuscript) (?:has been )?received\b|投稿成功|已收到您的稿件/.test(content)) return 'submitted';
  if (explicitReview(`${title}\n${content}`)) return 'under_review';
  if (/\b(?:submission|manuscript)\b|投稿|稿件/.test(title)) return 'under_review';
  return '';
}

export async function scanMailbox(email, secret, afterUid) {
  return inInbox(email, secret, async client => {
    if (afterUid >= await latestUid(client)) return { messages: [], lastUid: afterUid };
    const found = await client.search({ uid: `${Math.max(1, afterUid + 1)}:*` }, { uid: true });
    const uids = Array.isArray(found) ? found.map(Number).filter(uid => uid > afterUid).sort((a, b) => a - b).slice(0, MAX_PER_SCAN) : [];
    const messages = [];
    let lastUid = afterUid;
    for (const uid of uids) {
      const meta = await client.fetchOne(String(uid), { uid: true, size: true, envelope: true }, { uid: true });
      if (!meta) { lastUid = uid; continue; }
      const raw = await client.fetchOne(String(uid), { source: { maxLength: MAX_MESSAGE_BYTES } }, { uid: true });
      lastUid = uid;
      let parsed;
      try { if (raw?.source) parsed = await simpleParser(raw.source, { maxHtmlLengthToParse: MAX_MESSAGE_BYTES, maxTextLengthToParse: MAX_MESSAGE_BYTES }); }
      catch { /* Keep the header reminder when the body cannot be parsed. */ }
      const subject = String(parsed?.subject || meta.envelope?.subject || '(无主题)').slice(0, 500);
      const content = String(parsed?.text || '').slice(0, 12000);
      const status = classifyStatus(subject, content);
      const relevance = `${subject}\n${content}`;
      if (!/\bmanuscript\b|\bsubmission\b|\beditorial\b|\bjournal\b|\banbeh\b|animal behaviour|稿件|投稿|期刊|编辑|审稿/i.test(relevance)) continue;
      messages.push({
        uid,
        messageId: String(parsed?.messageId || meta.envelope?.messageId || '').slice(0, 500),
        subject,
        sender: String(parsed?.from?.value?.[0]?.address || meta.envelope?.from?.[0]?.address || '').slice(0, 254),
        received: Number.isFinite(new Date(parsed?.date || meta.envelope?.date || Date.now()).getTime()) ? new Date(parsed?.date || meta.envelope?.date || Date.now()).toISOString() : new Date().toISOString(),
        status,
        reviewDefault: status === 'under_review' && isDefaultReview(subject, content),
        text: relevance,
      });
    }
    return { messages, lastUid };
  });
}
