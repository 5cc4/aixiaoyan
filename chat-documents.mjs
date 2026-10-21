import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fail, text } from './store.mjs';

const uploads = new Set();
const extensions = new Set(['pdf', 'docx', 'txt', 'md', 'csv', 'json']);

async function extractDocument(bytes, extension) {
  const buffer = Buffer.from(bytes);
  if (extension === 'pdf') {
    if (!buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('不是有效的 PDF 文件');
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const info = await parser.getInfo();
      if (info.total > 120) throw new Error('PDF 超过 120 页，请拆分后上传');
      const result = await parser.getText();
      return result.text.replace(/--\s*\d+\s+of\s+\d+\s*--/g, '');
    } finally { await parser.destroy(); }
  }
  if (extension === 'docx') {
    if (buffer.subarray(0, 2).toString() !== 'PK') throw new Error('不是有效的 Word 文件');
    const { default: mammoth } = await import('mammoth');
    return (await mammoth.extractRawText({ buffer })).value;
  }
  const encoding = buffer[0] === 0xff && buffer[1] === 0xfe ? 'utf-16le' : 'utf-8';
  return new TextDecoder(encoding, { fatal: true }).decode(buffer);
}

if (!isMainThread) {
  try {
    let content = await extractDocument(workerData.bytes, workerData.extension);
    content = content.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
    if (!content) throw new Error('未读取到文字；扫描 PDF 请先转换为可选中文字的版本');
    if (content.length > 30000) throw new Error('文件文字超过 30000 字，请拆分后上传');
    parentPort.postMessage({ text: content });
  } catch (error) {
    parentPort.postMessage({ error: error.message || '文件无法读取' });
  }
}

export async function readChatDocument(req, userId) {
  let name;
  try { name = decodeURIComponent(req.headers['x-file-name'] || ''); } catch { fail(400, '文件名不正确'); }
  name = text(name, '文件名', 180);
  const extension = name.split('.').at(-1).toLowerCase();
  if (!extensions.has(extension)) fail(400, '支持 PDF、DOCX、TXT、Markdown、CSV、JSON 文件');
  if (uploads.has(userId) || uploads.size >= 2) fail(429, '正在读取文件，请稍后再试');
  uploads.add(userId);
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 8 * 1024 ** 2) fail(413, '文件不能超过 8 MB');
      chunks.push(chunk);
    }
    if (!size) fail(400, '文件为空');
    const content = await new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./chat-documents.mjs', import.meta.url), { workerData: { bytes: Buffer.concat(chunks), extension }, resourceLimits: { maxOldGenerationSizeMb: 192 } });
      const timer = setTimeout(() => { worker.terminate(); reject(new Error('文件读取超时，请拆分文件后重试')); }, 20000);
      const finish = () => { clearTimeout(timer); worker.terminate(); };
      worker.once('message', result => { finish(); if (result.error) reject(new Error(result.error)); else resolve(result.text); });
      worker.once('error', () => { finish(); reject(new Error('文件无法读取，请确认文件未加密且格式正确')); });
      worker.once('exit', () => { clearTimeout(timer); reject(new Error('文件读取中断，请使用较小文件')); });
    }).catch(error => fail(400, error.message));
    return { attachment: { name, text: content } };
  } finally { uploads.delete(userId); }
}

export function chatUserTurn(input) {
  const content = text(input.text ?? '', '消息', 12000, false);
  const files = input.attachments ?? [];
  if (!Array.isArray(files) || files.length > 3) fail(400, '每条消息最多添加 3 个文件');
  const attachments = files.map(file => {
    if (!file || typeof file !== 'object') fail(400, '附件格式不正确');
    return { name: text(file.name, '文件名', 180), text: text(file.text, '文件文字', 30000) };
  });
  if (attachments.reduce((sum, file) => sum + file.text.length, 0) > 36000) fail(400, '附件文字合计不能超过 36000 字');
  if (!content && !attachments.length) fail(400, '请输入消息或添加文件');
  return { role: 'user', content: content || '请分析附件内容。', ...(attachments.length ? { attachments } : {}) };
}

export function chatModelMessage(message) {
  const files = (message.attachments || []).map(file => `\n\n【用户提供的文件：${file.name}】\n${file.text}\n【文件结束】`).join('');
  return { role: message.role, content: message.content + files };
}
