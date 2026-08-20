'use strict';
/**
 * config.js — 配置读取
 *
 * 优先级：进程环境变量 > .env 文件（仅当 --env-file 未用时手工加载，见下方说明）> 默认值。
 *
 * 安全要求：ZHIPU_API_KEY 绝不写入任何代码、配置明文或日志。
 * 读取路径（按顺序）：
 *   1. 系统/用户环境变量 ZHIPU_API_KEY（推荐，WorkBuddy mcp.json 的 env 只放非敏感项）
 *   2. 项目根目录 .env 文件（需自行保证该文件权限与保密，且 .gitignore 排除）
 */

const fs = require('fs');
const path = require('path');

/** 加载项目根目录 .env 文件（简易解析，仅支持 KEY=VALUE 单行，忽略注释） */
function loadDotEnv(dir) {
  const envPath = path.join(dir, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

const ROOT_DIR = __dirname; // lib/
const PROJECT_DIR = path.resolve(ROOT_DIR, '..');

loadDotEnv(PROJECT_DIR);

const DEFAULT_MODEL = 'glm-4.6v-flash';
const DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
const DEFAULT_CHAT_ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

function toInt(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function toBool(v, fallback) {
  if (v === undefined || v === null || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

const config = {
  // 智谱
  apiKey: process.env.ZHIPU_API_KEY || '',          // 永不输出该值本身
  hasApiKey: Boolean(process.env.ZHIPU_API_KEY),
  model: process.env.GLM_MODEL || DEFAULT_MODEL,
  baseUrl: process.env.GLM_BASE_URL || DEFAULT_BASE_URL,
  chatEndpoint: process.env.GLM_CHAT_ENDPOINT || DEFAULT_CHAT_ENDPOINT,
  requestTimeoutMs: toInt(process.env.GLM_REQUEST_TIMEOUT_MS, 120000),   // 视频/长文档可能较慢
  imageTimeoutMs: toInt(process.env.GLM_IMAGE_TIMEOUT_MS, 60000),

  // Gemini（OpenAI 兼容端点；key 读 GEMINI_API_KEY，回退 GOOGLE_API_KEY —— 与 DSH settings 的 google provider 命名一致）
  geminiApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
  geminiHasApiKey: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.5-flash',
  geminiBaseUrl: process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai',
  geminiChatEndpoint:
    process.env.GEMINI_CHAT_ENDPOINT ||
    (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai').replace(/\/+$/, '') +
      '/chat/completions',
  geminiRequestTimeoutMs: toInt(process.env.GEMINI_REQUEST_TIMEOUT_MS, 120000),

  // 默认后端：glm | gemini | auto（auto = 优先 GLM，限流/5xx 时回退 Gemini；GLM 无 key 时直接用 Gemini）
  defaultProvider: (process.env.VISION_PROVIDER || 'auto').toLowerCase(),

  // 重试：仅 429/5xx/网络错误，最多 2 次（共 3 次尝试），指数退避
  maxRetries: toInt(process.env.GLM_MAX_RETRIES, 2),
  retryBaseDelayMs: toInt(process.env.GLM_RETRY_BASE_DELAY_MS, 800),

  // 文件大小上限（字节）
  maxImageBytes: toInt(process.env.GLM_MAX_IMAGE_MB, 10) * 1024 * 1024,
  maxVideoBytes: toInt(process.env.GLM_MAX_VIDEO_MB, 200) * 1024 * 1024,
  maxFileBytes: toInt(process.env.GLM_MAX_FILE_MB, 50) * 1024 * 1024,

  // 本地视频/文件是否允许以 data URI 方式尝试（官方未承诺支持；失败时返回可操作错误）
  allowLocalVideoDataUri: toBool(process.env.GLM_ALLOW_LOCAL_VIDEO_DATA_URI, true),
  allowLocalFileDataUri: toBool(process.env.GLM_ALLOW_LOCAL_FILE_DATA_URI, true),

  // 首次上传本地文件的隐私提示开关
  privacyNoticeEnabled: toBool(process.env.GLM_PRIVACY_NOTICE, true),

  // 允许访问的本地目录（逗号分隔），未配置时默认仅允许当前工作区/项目目录与系统临时目录
  allowedDirsRaw: process.env.GLM_ALLOWED_DIRS || '',
  // 是否默认允许系统临时目录（严格模式可关）
  allowTmpDir: toBool(process.env.GLM_ALLOW_TMP, true),
  version: '1.0.0',
  serverName: 'glm-vision-mcp',
};

/** 展开 ~ 为 HOME */
function expandHome(p) {
  if (!p) return p;
  if (p === '~') return process.env.USERPROFILE || process.env.HOME || p;
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    const home = process.env.USERPROFILE || process.env.HOME || '';
    if (home) return path.join(home, p.slice(2));
  }
  return p;
}

config.allowedDirs = config.allowedDirsRaw
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map(expandHome)
  .map((p) => path.resolve(p));

module.exports = config;
