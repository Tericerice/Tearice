'use strict';
/**
 * zhipu.js — 智谱 GLM 多模态调用（OpenAI 兼容协议，与官方 cURL 文档一致）
 *
 * 设计：
 *   - 直接调用官方 chat/completions 端点（https://open.bigmodel.cn/api/paas/v4/chat/completions），
 *     遵循官方文档的 image_url / video_url / file_url 内容块格式；
 *   - 官方限制：一次请求只允许单一模态（不支持同时混传文件/视频/图像），由 source.js 保证；
 *   - 重试：仅 429 / 5xx / 网络错误，最多 GLM_MAX_RETRIES 次，指数退避，禁止无限重试；
 *   - 错误转换：把 provider 错误、HTTP 状态码、限流、超时转换为结构化错误，绝不输出堆栈污染对话。
 */

const config = require('./config');

/** 结构化 provider 错误 */
class ProviderError extends Error {
  /**
   * @param {string} code 稳定错误码（供上层映射为 MCP error）
   * @param {string} message 面向用户的可操作信息
   * @param {object} meta 附加元数据（status, retryable, detail 等）
   */
  constructor(code, message, meta = {}) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.meta = meta;
  }
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function delayForAttempt(attempt, base) {
  return base * 2 ** attempt + Math.floor(Math.random() * 200);
}

/**
 * 调用智谱 chat/completions。
 * @param {object} opts
 * @param {string} opts.mediaType image|video|file
 * @param {string} opts.mediaUrl  已解析好的 URL（data URI 或公网 URL）
 * @param {string} opts.prompt    用户分析要求（可含系统指令前缀）
 * @param {boolean} opts.thinking 是否开启 thinking
 * @param {string} opts.responseFormat text|json
 * @param {number} opts.timeoutMs
 * @param {string} [opts.endpoint] 覆盖 chatEndpoint（测试用）
 * @returns {Promise<{content:string, reasoning:string|null, usage:object|null, latencyMs:number}>}
 */
async function callZhipu({ mediaType, mediaUrl, prompt, thinking, responseFormat, timeoutMs, endpoint }) {
  if (!config.hasApiKey) {
    throw new ProviderError(
      'NO_API_KEY',
      '未配置智谱 API Key。请设置环境变量 ZHIPU_API_KEY（或项目 .env），然后重启 WorkBuddy / MCP 进程。'
    );
  }

  const content = [];
  const typeKey = mediaType === 'image' ? 'image_url' : mediaType === 'video' ? 'video_url' : 'file_url';
  content.push({
    type: typeKey,
    [typeKey]: { url: mediaUrl },
  });
  content.push({ type: 'text', text: prompt });

  const body = {
    model: config.model,
    messages: [
      {
        role: 'user',
        content,
      },
    ],
    thinking: { type: thinking ? 'enabled' : 'disabled' },
  };
  if (responseFormat === 'json') {
    body.response_format = { type: 'json_object' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || config.requestTimeoutMs);

  let lastErr = null;
  let attempts = 0;
  const totalAttempts = 1 + config.maxRetries;
  const t0 = Date.now();

  while (attempts < totalAttempts) {
    attempts += 1;
    try {
      const res = await fetch(endpoint || config.chatEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
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
        const providerErr = buildProviderError(res.status, errCode, errMsg);
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
        reasoning:
          typeof message.reasoning_content === 'string' ? message.reasoning_content : (message.reasoning_content || null),
        usage: parsed.usage || null,
        latencyMs: Date.now() - t0,
        raw: parsed,
      };
    } catch (e) {
      // AbortError → 超时
      if (e && e.name === 'AbortError') {
        throw new ProviderError('TIMEOUT', `请求超时（${timeoutMs}ms）。可增大 GLM_REQUEST_TIMEOUT_MS 后重试。`, {
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
      // 网络级错误（fetch 失败、DNS、连接重置）
      const netErr = new ProviderError(
        'NETWORK_ERROR',
        `无法连接智谱 API（${e && e.message ? e.message : '网络错误'}）。请检查网络/代理后重试。`,
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
    new ProviderError('UNKNOWN', '智谱 API 调用失败（未知错误）', { retryable: false })
  );
}

/** 把 HTTP 状态码 + provider error 转成稳定错误码 */
function buildProviderError(status, errCode, errMsg) {
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
        `智谱 API 认证失败（HTTP 401${errCode ? ` / ${errCode}` : ''}）。请检查 ZHIPU_API_KEY 是否正确、是否已过期或未实名认证。`,
        base
      );
    case 403:
      return new ProviderError(
        'FORBIDDEN',
        `智谱 API 拒绝访问（HTTP 403${errCode ? ` / ${errCode}` : ''}）：${errMsg || '账号无权限或未开通该模型'}`,
        base
      );
    case 404:
      return new ProviderError(
        'MODEL_NOT_FOUND',
        `模型不存在或接口地址错误（HTTP 404 / ${errCode || errMsg}）。请检查 GLM_MODEL 与 GLM_CHAT_ENDPOINT 配置。`,
        base
      );
    case 429:
      return new ProviderError(
        'RATE_LIMITED',
        `智谱 API 限流/额度不足（HTTP 429${errCode ? ` / ${errCode}` : ''}）：${errMsg || '请求过于频繁或免费额度已用完'}。请稍后重试或检查账户额度。`,
        base
      );
    case 400:
      return new ProviderError(
        'BAD_REQUEST',
        `请求参数被智谱拒绝（HTTP 400 / ${errCode || errMsg}）。若为本地视频/文件，可能是不支持该 data URI 形式，请改用公网 URL。`,
        base
      );
    case 500:
    case 502:
    case 503:
    case 504:
      return new ProviderError(
        'PROVIDER_ERROR',
        `智谱服务暂时不可用（HTTP ${status}${errCode ? ` / ${errCode}` : ''}），已自动重试。`,
        base
      );
    default:
      return new ProviderError(
        'PROVIDER_ERROR',
        `智谱 API 返回异常（HTTP ${status}${errCode ? ` / ${errCode}` : ''}）：${errMsg || '未知错误'}`,
        base
      );
  }
}

module.exports = { callZhipu, ProviderError, buildProviderError, RETRYABLE_STATUS };
