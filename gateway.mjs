import { readFile } from 'node:fs/promises';
import { fail, text } from './store.mjs';

export const gatewayBase = 'http://127.0.0.1:3001/v1';
const upstreamBase = 'https://openrouter.ai/api/v1';
// Reviewed 2026-10-07 against provider documentation and server reachability.
export const additionalFreeModels = [
  { id: 'Qwen/Qwen3-8B', name: '硅基流动 · Qwen3 8B（免费）', platform: 'siliconflow', base: 'https://api.siliconflow.cn/v1' },
  { id: 'XingChenAGI/Xing4.0-29B', name: '硅基流动 · 星辰 4.0 29B（免费）', platform: 'siliconflow', base: 'https://api.siliconflow.cn/v1' },
  { id: 'glm-4.7-flash', name: '智谱 · GLM 4.7 Flash（免费）', platform: 'zhipu', base: 'https://open.bigmodel.cn/api/paas/v4' },
];
let modelCache;
let modelCacheUntil = 0;
let modelFetch;

// Only explicit free IDs with zero published pricing enter the selector.
export async function freeModels() {
  if (modelCache && Date.now() < modelCacheUntil) return modelCache;
  if (modelFetch) return modelFetch;
  modelFetch = (async () => {
    try {
      const response = await fetch(`${upstreamBase}/models`, { redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error();
      const result = await response.json();
      const models = result.data.filter(m => (m.id === 'openrouter/free' || m.id.endsWith(':free')) &&
        m.pricing?.prompt != null && m.pricing?.completion != null &&
        Object.values(m.pricing).every(price => price !== null && Number(price) === 0) &&
        m.architecture?.output_modalities?.includes('text') && /^[\w./:-]{1,180}$/.test(m.id))
        .map(m => ({ id: m.id, name: m.id === 'openrouter/free' ? '免费模型自动选择' : m.name, context: m.context_length }));
      if (!models.length) throw new Error();
      modelCache = models.sort((a, b) => a.id === 'openrouter/free' ? -1 : b.id === 'openrouter/free' ? 1 : a.name.localeCompare(b.name));
      modelCacheUntil = Date.now() + 120000;
      return modelCache;
    } catch { fail(503, '暂时无法确认免费模型目录，请稍后刷新；未调用任何模型。'); }
  })();
  try { return await modelFetch; } finally { modelFetch = null; }
}

export async function requireFreeModel(model) {
  const additional = additionalFreeModels.find(m => m.id === model);
  if (additional) return additional;
  const item = (await freeModels()).find(m => m.id === model);
  if (!item) fail(400, '该模型已不在免费目录，请在设置中重新选择免费模型。');
  return item;
}

export async function createGateway(configPath) {
  if (!configPath) return null;
  const credentials = JSON.parse(await readFile(configPath, 'utf8'));
  let session;
  let loggingIn;
  async function request(path, method = 'GET', body, retry = true) {
    try {
      if (!session && path !== '/auth/login') {
        loggingIn ||= request('/auth/login', 'POST', credentials.admin).then(result => { session = result.token; }).finally(() => { loggingIn = null; });
        await loggingIn;
      }
      const response = await fetch(`http://127.0.0.1:3001/api${path}`, {
        method, headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(20000),
      });
      if (response.status === 401 && path !== '/auth/login' && retry) { session = null; return request(path, method, body, false); }
      if (!response.ok) { await response.body?.cancel(); fail(502, `免费模型后台暂时无法完成操作（${response.status}），请稍后重试。`); }
      return await response.json();
    } catch (error) { if (error.status) throw error; fail(503, 'FreeLLMAPI 后台尚未连接，请联系管理员。'); }
  }
  async function keys(base = upstreamBase) {
    return (await request('/keys')).filter(k => k.platform === 'custom' && k.baseUrl === base);
  }
  return {
    async status() {
      const rows = await keys();
      const allKeys = await request('/keys');
      let models = [], notice = '';
      try { models = await freeModels(); } catch (error) { notice = error.message; }
      const additional = additionalFreeModels.filter(m => allKeys.some(k => k.platform === 'custom' && k.baseUrl === m.base && k.enabled));
      return { connected: true, configured: allKeys.some(k => k.enabled && (k.platform !== 'custom' || additionalFreeModels.some(m => m.base === k.baseUrl) || k.baseUrl === upstreamBase)), models: [...additional, ...models], notice };
    },
    async save(input) {
      const model = await requireFreeModel(text(input.model, '模型', 180));
      const apiKey = text(input.apiKey || '', 'API Key', 4096, false);
      if (/[\r\n]/.test(apiKey)) fail(400, 'API Key 不能包含换行');
      const base = model.base || upstreamBase;
      const rows = await keys(base);
      if (model.platform && apiKey) fail(400, '此处密钥栏仅用于 OpenRouter；其他平台已保存密钥，请留空');
      if (model.platform && !rows.some(k => k.enabled)) fail(400, '该平台密钥尚未配置或已停用');
      if (!apiKey && !rows.length) fail(400, '首次接入需要填写 OpenRouter API Key');
      if (rows.length && apiKey) await request(`/keys/${rows[0].id}`, 'PATCH', { key: apiKey, enabled: true });
      await request('/keys/custom', 'POST', {
        baseUrl: base, model: model.id, displayName: model.name, label: '爱小研免费模型',
        ...(rows.length ? { keyId: rows[0].id } : { apiKey }), supportsTools: false, supportsVision: false,
      });
      const unified = await request('/settings/api-key');
      return { model: model.id, label: model.name, apiKey: unified.apiKey };
    },
    async disconnect() {
      const bases = new Set([upstreamBase, ...additionalFreeModels.map(m => m.base)]);
      for (const key of await request('/keys')) if (key.platform === 'custom' && bases.has(key.baseUrl)) await request(`/keys/${key.id}`, 'DELETE');
    },
  };
}
