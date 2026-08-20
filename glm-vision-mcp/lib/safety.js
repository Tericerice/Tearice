'use strict';
/**
 * safety.js — 路径与文件安全
 *
 * 规则：
 *   1. 本地文件必须位于允许目录内（当前工作区 / 用户显式配置的 GLM_ALLOWED_DIRS / 系统临时目录）。
 *   2. 拒绝读取敏感文件：Cookie、Token、私钥、API Key、.env、浏览器 Profile 等。
 *   3. 所有判定返回 { ok, reason? }，不直接 throw，方便上层给出可操作的 MCP 错误。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('./config');

/** 敏感文件名/目录名片段（小写匹配，命中即拒绝） */
const SENSITIVE_NAME_PATTERNS = [
  /(^|[/\\])\.env(\.|$)/,        // .env / .env.local / .env.production
  /\bcookie[s]?([._-]|$)/,       // cookies.txt, cookie jar
  /token([._-]|\b)/,             // token.json, id_token
  /(^|[/\\_])secret([._-]|\b)/,  // secret.key, .secret
  /(^|[/\\])\.ssh([/\\]|$)/,     // ~/.ssh
  /(^|[/\\])\.aws([/\\]|$)/,
  /(^|[/\\])\.gnupg([/\\]|$)/,
  /(^|[/\\])\.kube([/\\]|$)/,
  /(^|[/\\])\.config([/\\])/,    // 各类 app 配置（浏览器 profile、凭证）
  /(^|[/\\])\.local([/\\])/,
  /\.(pem|key|p12|pfx|jks|keystore)$/i,
  /(^|[/\\])id_[a-z0-9_.-]+$/i,  // id_rsa / id_ed25519 / id_dsa 等私钥
  /credential/i,
  /api[_-]?key/i,
  /wallet/i,
  /passwd/i,
  /\.history$/i,                 // bash_history, zsh_history
  /\.(sqlite|sqlite3|db)$/i,     // 本地数据库（登录态/会话）
  /login(\.|_)|auth(\.|_)/i,
  /(^|[/\\])profile([/\\])/,     // 浏览器 Profile
  /(^|[/\\])Local[- ]?State$/i,
  /(^|[/\\])Cookies$/i,
];

/** 敏感扩展名集合 */
const SENSITIVE_EXT = new Set(['.pem', '.key', '.p12', '.pfx', '.jks', '.keystore', '.kdbx']);

function isSensitivePath(p) {
  const lower = p.toLowerCase();
  if (SENSITIVE_EXT.has(path.extname(lower))) return true;
  return SENSITIVE_NAME_PATTERNS.some((re) => re.test(lower));
}

/**
 * 规范化并校验本地路径是否允许读取。
 * @param {string} p 用户传入的本地路径
 * @param {string[]} extraAllowedDirs 额外允许的目录（如当前工作区）
 * @returns {{ok: true, resolved: string} | {ok: false, reason: string, code: string}}
 */
function resolveAllowedPath(p, extraAllowedDirs = []) {
  if (typeof p !== 'string' || !p.trim()) {
    return { ok: false, code: 'INVALID_PATH', reason: 'source 不能为空' };
  }
  const candidate = path.resolve(p);

  // 1) 敏感路径拒绝（在任何读取之前）
  if (isSensitivePath(candidate)) {
    return {
      ok: false,
      code: 'SENSITIVE_PATH',
      reason: `拒绝访问敏感路径（可能包含凭证/私钥/登录态）: ${candidate}`,
    };
  }

  // 2) 文件必须存在且为普通文件
  let stat;
  try {
    stat = fs.statSync(candidate);
  } catch (e) {
    return { ok: false, code: 'NOT_FOUND', reason: `本地文件不存在或无法访问: ${p}` };
  }
  if (!stat.isFile()) {
    return { ok: false, code: 'NOT_FILE', reason: `不是普通文件: ${p}` };
  }

  // 3) 位于允许目录内
  const allowed = allowedDirSet(extraAllowedDirs);
  const parentOf = (dir) => {
    let d = path.resolve(dir);
    const set = new Set();
    while (true) {
      set.add(d);
      const up = path.dirname(d);
      if (up === d) break;
      d = up;
    }
    return set;
  };
  const ancestors = parentOf(candidate);
  for (const dir of allowed) {
    if (ancestors.has(path.resolve(dir))) {
      return { ok: true, resolved: candidate, stat };
    }
  }
  return {
    ok: false,
    code: 'PATH_NOT_ALLOWED',
    reason: `路径不在允许读取的目录内（仅允许当前工作区、GLM_ALLOWED_DIRS 配置的目录与临时目录）: ${candidate}`,
  };
}

let _allowedSet = null;
function allowedDirSet(extra = []) {
  if (_allowedSet && extra.length === 0) return _allowedSet;
  const dirs = new Set();
  const addDir = (d) => {
    if (!d) return;
    try {
      dirs.add(path.resolve(d));
    } catch (_) {
      /* 忽略非法目录 */
    }
  };
  // 默认允许：当前工作目录、项目目录、系统临时目录（GLM_ALLOW_TMP=false 可关闭临时目录）
  addDir(process.cwd());
  addDir(config.PROJECT_DIR || path.resolve(__dirname, '..'));
  if (config.allowTmpDir !== false) addDir(os.tmpdir());
  for (const d of config.allowedDirs) addDir(d);
  for (const d of extra) addDir(d);
  _allowedSet = dirs;
  return _allowedSet;
}

/** 读取文件字节（调用前必须已通过 resolveAllowedPath） */
function readFileBytes(resolvedPath, maxBytes) {
  const size = fs.statSync(resolvedPath).size;
  if (size > maxBytes) {
    return {
      ok: false,
      code: 'FILE_TOO_LARGE',
      reason: `文件 ${size} 字节超过上限 ${maxBytes} 字节，请压缩或改用公网 URL`,
    };
  }
  const buf = fs.readFileSync(resolvedPath);
  return { ok: true, bytes: buf, size: buf.length };
}

module.exports = {
  resolveAllowedPath,
  readFileBytes,
  isSensitivePath,
  allowedDirSet,
  SENSITIVE_NAME_PATTERNS,
};
