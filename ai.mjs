import { fail, text } from './store.mjs';
import { gatewayBase, requireFreeModel } from './gateway.mjs';

export const providers = [
  { id: 'deepseek', name: 'DeepSeek', protocol: 'chat', bases: ['https://api.deepseek.com/v1'] },
  { id: 'qwen', name: '通义千问 / 百炼', protocol: 'chat', bases: ['https://dashscope.aliyuncs.com/compatible-mode/v1', 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'] },
  { id: 'doubao', name: '豆包 / 火山方舟', protocol: 'chat', bases: ['https://ark.cn-beijing.volces.com/api/v3'] },
  { id: 'siliconflow', name: '硅基流动', protocol: 'chat', bases: ['https://api.siliconflow.cn/v1'] },
  { id: 'openai', name: 'OpenAI', protocol: 'responses', bases: ['https://api.openai.com/v1'] },
  { id: 'anthropic', name: 'Claude / Anthropic', protocol: 'anthropic', bases: ['https://api.anthropic.com/v1'] },
  { id: 'gemini', name: 'Google Gemini', protocol: 'gemini', bases: ['https://generativelanguage.googleapis.com/v1beta'] },
];
export function catalog(extraBases = '', enableGateway = false) {
  const extras = extraBases.split(',').map(x => x.trim().replace(/\/$/, '')).filter(Boolean);
  for (const base of extras) {
    const url = new URL(base);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('AI_EXTRA_BASE_URLS 必须是可信的 HTTPS 基础地址');
  }
  return [...providers, ...(enableGateway ? [{ id: 'freellmapi', name: '小研AI', protocol: 'chat', bases: [gatewayBase] }] : []), ...(extras.length ? [{ id: 'custom', name: '其他兼容平台', protocol: 'chat', bases: extras }] : [])];
}
export function configInput(body, available) {
  const provider = available.find(x => x.id === body.provider);
  if (!provider) fail(400, '不支持的 AI 平台');
  const base = body.base || provider.bases[0];
  if (!provider.bases.includes(base)) fail(400, '请选择平台提供的服务地址');
  const scope = body.scope || 'personal';
  if (!['personal', 'global'].includes(scope)) fail(400, '配置范围不正确');
  const model = text(body.model, '模型 ID', 180);
  if (!/^[\w./:-]+$/.test(model)) fail(400, '模型 ID 只能包含字母、数字和 . / : _ -');
  const apiKey = text(body.apiKey ?? '', 'API Key', 4096, false);
  if (/[\r\n]/.test(apiKey)) fail(400, 'API Key 不能包含换行');
  return { provider: provider.id, base, scope, model, label: text(body.label, '显示名称', 80), apiKey };
}
export function modelRequest(config, messages, available = providers, stream = false) {
  const provider = available.find(x => x.id === config.provider);
  if (!provider || !provider.bases.includes(config.base)) fail(400, '平台地址未获服务器配置允许');
  if (config.provider === 'freellmapi' && config.model === 'Qwen/Qwen3-8B') {
    const lastUser = messages.findLastIndex(message => message.role === 'user');
    // Qwen's documented soft switch survives the gateway's standard chat schema.
    messages = messages.map((message, index) => index === lastUser ? { ...message, content: `${message.content}\n/no_think` } : message);
  }
  const headers = { 'Content-Type': 'application/json' };
  let url = config.base;
  let body;
  if (provider.protocol === 'anthropic') {
    url += '/messages';
    headers['x-api-key'] = config.apiKey;
    headers['anthropic-version'] = '2023-06-01';
    body = { model: config.model, max_tokens: 4096, messages };
  } else if (provider.protocol === 'gemini') {
    url += `/models/${encodeURIComponent(config.model.replace(/^models\//, ''))}:generateContent`;
    headers['x-goog-api-key'] = config.apiKey;
    body = { contents: messages.map(x => ({ role: x.role === 'assistant' ? 'model' : 'user', parts: [{ text: x.content }] })), generationConfig: { maxOutputTokens: 4096 } };
  } else if (provider.protocol === 'responses') {
    url += '/responses';
    headers.Authorization = `Bearer ${config.apiKey}`;
    body = { model: config.model, input: messages, max_output_tokens: 4096, store: false };
  } else {
    url += '/chat/completions';
    headers.Authorization = `Bearer ${config.apiKey}`;
    body = { model: config.model, messages, stream, max_tokens: 4096 };
  }
  return { url, headers, body, protocol: provider.protocol };
}
export function modelText(protocol, result) {
  let output;
  if (protocol === 'responses') output = result.output?.flatMap(x => x.content || []).filter(x => x.type === 'output_text').map(x => x.text).join('\n');
  else if (protocol === 'anthropic') output = result.content?.filter(x => x.type === 'text').map(x => x.text).join('\n');
  else if (protocol === 'gemini') output = result.candidates?.[0]?.content?.parts?.filter(x => !x.thought).map(x => x.text || '').join('\n');
  else output = result.choices?.[0]?.message?.content;
  if (typeof output !== 'string' || !output.trim()) fail(502, '模型未返回可显示的文字，可能触发内容限制或输出额度不足');
  return output.slice(0, 60000);
}
export async function streamModel(config, messages, available, onToken, { signal, firstTokenMs = 12000, onReasoning } = {}) {
  if (config.provider !== 'freellmapi') fail(400, '小研AI流式回复仅支持免费模型池');
  const firstToken = new AbortController();
  const firstTimer = setTimeout(() => firstToken.abort(new Error('模型首字响应超时')), firstTokenMs);
  const combined = AbortSignal.any([firstToken.signal, AbortSignal.timeout(90000), ...(signal ? [signal] : [])]);
  let reader;
  let answer = '';
  let reasoningSeen = false;
  try {
    await requireFreeModel(config.model);
    combined.throwIfAborted();
    const request = modelRequest(config, messages, available, true);
    const response = await fetch(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(request.body), redirect: 'error', signal: combined });
    if (!response.ok) {
      await response.body?.cancel();
      const labels = { 401: '密钥无效', 402: '免费额度不足', 403: '服务器区域不支持', 404: '模型暂不可用', 429: '请求过多或免费额度不足', 503: '模型暂不可用' };
      fail(502, labels[response.status] || `模型服务返回 ${response.status}`);
    }
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      let timer;
      const next = await Promise.race([
        reader.read(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('模型回复中断')), 45000); }),
      ]).finally(() => clearTimeout(timer));
      const { value, done } = next;
      if (done) break;
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
        if (!data || data === '[DONE]') continue;
        let payload;
        try { payload = JSON.parse(data); } catch { continue; }
        const delta = payload.choices?.[0]?.delta;
        const reasoning = delta?.reasoning_content ?? delta?.reasoning;
        if (!answer && !reasoningSeen && typeof reasoning === 'string' && reasoning.trim()) {
          reasoningSeen = true;
          onReasoning?.();
        }
        const token = delta?.content;
        if (typeof token === 'string' && token) {
          clearTimeout(firstTimer);
          if (answer.length + token.length > 60000) fail(502, '回复过长，请缩小问题范围');
          answer += token; onToken(token);
        }
      }
    }
  } catch (error) {
    if (answer) fail(502, '模型连接中断，已收到的回复已保留');
    if (signal?.aborted) throw error;
    fail(502, firstToken.signal.aborted ? '模型首字响应超时' : error.status ? error.message : '模型连接超时或中断');
  } finally {
    clearTimeout(firstTimer);
    await reader?.cancel().catch(() => {});
  }
  if (!answer.trim()) fail(502, '模型没有返回可显示的文字');
  return answer.slice(0, 60000);
}

export async function callModel(config, messages, available = providers) {
  if (config.provider === 'freellmapi') await requireFreeModel(config.model);
  const request = modelRequest(config, messages, available);
  let response;
  try {
    response = await fetch(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(request.body), redirect: 'error', signal: AbortSignal.timeout(config.provider === 'freellmapi' ? 15000 : 90000) });
    if (!response.ok) {
      await response.body?.cancel();
      const hints = { 401: '密钥无效', 402: '平台额度不足；不会自动充值', 403: '账号或地区无访问权限', 404: '模型 ID 或服务地址不正确', 429: '平台限流或账号余额不足', 503: '暂无可用模型，请稍后重试' };
      if (config.provider === 'freellmapi' && [402, 429, 503].includes(response.status)) fail(502, '免费模型暂不可用或免费额度已用完，请稍后重试；未切换付费模型。');
      fail(502, `AI 平台返回 ${response.status}：${hints[response.status] || '请检查平台控制台或稍后重试'}`);
    }
    const chunks = [];
    let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > 2 * 1024 * 1024) fail(502, 'AI 响应过大，请缩短请求');
      chunks.push(chunk);
    }
    return modelText(request.protocol, JSON.parse(Buffer.concat(chunks).toString('utf8')));
  } catch (error) {
    if (error.status) throw error;
    fail(502, error.name === 'TimeoutError' ? 'AI 响应超时，请稍后重试' : '无法连接 AI 平台，请检查服务器网络和平台配置');
  }
}
