'use strict';
/**
 * gemini.js — Google Gemini 视觉调用（OpenAI 兼容端点）
 *
 * 设计：
 *   - 走 Gemini 的 OpenAI 兼容端点（https://generativelanguage.googleapis.com/v1beta/openai/chat/completions），
 *     与 DSH settings 中 google provider 的 baseURL 一致；
 *   - 当前仅支持 image 模态（image_url content 块：data URI 或公网 URL）；
 *     video/file 模态由 source.js 解析，但 Gemini OpenAI 兼容层不支持 video_url/file_url 块，
 *     本模块对非 image 请求直接给出可操作错误（请改用 provider=glm 或公网 URL 经智谱分析）；
 *   - 重试/错误转换与 zhipu.js 同一套语义（429/5xx/网络重试，稳定错误码）。
 */

const config = require('./config');
const { ProviderError, buildProviderError, RETRYABLE_STATUS, sleep, delayForAttempt } = (() => {
  const z = require('./zhipu');
  return {
    ProviderError: z.ProviderError,
    buildProviderError: z.buildProviderError,
    RETRYABLE_STATUS: z.RETRYABLE_STATUS,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    delayForAttempt: (attempt, base) => base * 2 ** attempt + Math.floor(Math.random() * 200),
  };
})();

// Google 服务需代理访问：Node 22 原生 fetch 不读代理环境变量，这里显式用 undici ProxyAgent。
// 仅当环境存在 HTTP(S)_PROXY / ALL_PROXY 时启用；智谱是国内 API，zhipu.js 不受影响。
const { ProxyAgent } = require('undici');
const PROXY_URL = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY || '';
const proxyDispatcher = PROXY_URL ? new ProxyAgent(PROXY_URL) : undefined;

/**
 * 调用 Gemini OpenAI 兼容 chat/completions（仅图片）。
 * @param {object} opts
 * @param {string} opts.mediaType image（video/file 会被拒绝）
 * @param {string} opts.mediaUrl  已解析好的图片 URL（data URI 或公网 URL）
 * @param {string} opts.prompt    用户分析要求（可含系统指令前缀）
 * @param {boolean} opts.thinking 忽略（Gemini OpenAI 兼容层无 thinking 开关）
 * @param {string} opts.responseFormat text|json
 * @param {number} opts.timeoutMs
 * @returns {Promise<{content:string, reasoning:string|null, usage:object|null, latencyMs:number}>}
 */
async function callGemini({ mediaType, mediaUrl, prompt, thinking, responseFormat, timeoutMs }) {
  if (!config.geminiHasApiKey) {
    throw new ProviderError(
      'NO_API_KEY',
      '未配置 Gemini API Key。请设置环境变量 GEMINI_API_KEY 或 GOOGLE_API_KEY（或项目 .env），然后重启 MCP 进程。'
    );
  }
  if (mediaType !== 'image') {
    throw new ProviderError(
      'UNSUPPORTED_MEDIA',
      `Gemini 后端仅支持图片分析（收到 ${mediaType}）。视频/PDF/文档请使用 provider=glm（智谱）或公网 URL。`,
      { mediaType }
    );
  }

  const content = [{ type: 'image_url', image_url: { url: mediaUrl } }, { type: 'text', text: prompt }];
  const body = {
    model: config.geminiModel,
    messages: [{ role: 'user', content }],
  };
  if (responseFormat === 'json') {
    body.response_format = { type: 'json_object' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || config.geminiRequestTimeoutMs);

  let lastErr = null;
  let attempts = 0;
  const totalAttempts = 1 + config.maxRetries;
  const t0 = Date.now();

  while (attempts < totalAttempts) {
    attempts += 1;
    try {
      const res = await fetch(config.geminiChatEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.geminiApiKey}`,
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
        ...(proxyDispatcher ? { dispatcher: proxyDispatcher } : {}),
      });

      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch (_) {
        json = null;
      }

      if (!res.ok) {
        const errCode = json && json.error ? String(json.error.code || '') : '';
        const errMsg = json && json.error ? String(json.error.message || '') : text.slice(0, 300);
        const providerErr = buildGeminiProviderError(res.status, errCode, errMsg);
        if (providerErr.meta.retryable && attempts < totalAttempts) {
          lastErr = providerErr;
          await sleep(delayForAttempt(attempts - 1, config.retryBaseDelayMs));
          continue;
        }
        throw providerErr;
      }

      const parsed = json || (text ? JSON.parse(text) : {});
      const choice = parsed.choices && parsed.choices[0];
      const message = choice ? choice.message || {} : {};
      return {
        content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content || ''),
        reasoning: null,
        usage: parsed.usage || null,
        latencyMs: Date.now() - t0,
        raw: parsed,
      };
    } catch (e) {
      if (e && e.name === 'AbortError') {
        throw new ProviderError('TIMEOUT', `请求超时（${timeoutMs}ms）。可增大 GEMINI_REQUEST_TIMEOUT_MS 后重试。`, {
          retryable: true,
        });
      }
      if (e instanceof ProviderError) {
        if (e.meta.retryable && attempts < totalAttempts) {
          lastErr = e;
          await sleep(delayForAttempt(attempts - 1, config.retryBaseDelayMs));
          continue;
        }
        throw e;
      }
      const netErr = new ProviderError(
        'NETWORK_ERROR',
        `无法连接 Gemini API（${e && e.message ? e.message : '网络错误'}）。请检查网络/代理后重试。`,
        { retryable: true }
      );
      if (attempts < totalAttempts) {
        lastErr = netErr;
        await sleep(delayForAttempt(attempts - 1, config.retryBaseDelayMs));
        continue;
      }
      throw netErr;
    } finally {
      clearTimeout(timer);
    }
  }

  throw (
    lastErr ||
    new ProviderError('UNKNOWN', 'Gemini API 调用失败（未知错误）', { retryable: false })
  );
}

/** Gemini 的稳定错误码（文案指向 Gemini 配置项） */
function buildGeminiProviderError(status, errCode, errMsg) {
  const base = {
    status,
    errCode,
    errMsg: errMsg || '',
    retryable: RETRYABLE_STATUS.has(status),
  };
  switch (status) {
    case 401:
      return new ProviderError(
        'AUTH_FAILED',
        `Gemini API 认证失败（HTTP 401${errCode ? ` / ${errCode}` : ''}）。请检查 GEMINI_API_KEY / GOOGLE_API_KEY 是否正确。`,
        base
      );
    case 403:
      return new ProviderError(
        'FORBIDDEN',
        `Gemini API 拒绝访问（HTTP 403${errCode ? ` / ${errCode}` : ''}）：${errMsg || '账号无权限或未开通该模型'}`,
        base
      );
    case 404:
      return new ProviderError(
        'MODEL_NOT_FOUND',
        `模型不存在或接口地址错误（HTTP 404 / ${errCode || errMsg}）。请检查 GEMINI_MODEL 与 GEMINI_BASE_URL 配置。`,
        base
      );
    case 429:
      return new ProviderError(
        'RATE_LIMITED',
        `Gemini API 限流/额度不足（HTTP 429${errCode ? ` / ${errCode}` : ''}）：${errMsg || '请求过于频繁或额度已用完'}。请稍后重试或检查账户额度。`,
        base
      );
    case 400:
      return new ProviderError(
        'BAD_REQUEST',
        `请求参数被 Gemini 拒绝（HTTP 400 / ${errCode || errMsg}）。图片格式可能不受支持，或该模态需走原生 API。`,
        base
      );
    case 500:
    case 502:
    case 503:
    case 504:
      return new ProviderError(
        'PROVIDER_ERROR',
        `Gemini 服务暂时不可用（HTTP ${status}${errCode ? ` / ${errCode}` : ''}），已自动重试。`,
        base
      );
    default:
      return new ProviderError(
        'PROVIDER_ERROR',
        `Gemini API 返回异常（HTTP ${status}${errCode ? ` / ${errCode}` : ''}）：${errMsg || '未知错误'}`,
        base
      );
  }
}

module.exports = { callGemini, ProviderError };
