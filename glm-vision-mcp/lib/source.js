'use strict';
/**
 * source.js — 输入源解析
 *
 * 职责：
 *   1. 区分 URL（http/https/data:）与本地路径；
 *   2. 自动推断 media_type（image / video / file）；
 *   3. 本地图片 → Base64 data URL（官方文档明确支持）；
 *   4. 本地视频/文件 → 默认走 data URI 尝试（GLM_ALLOW_LOCAL_VIDEO_DATA_URI / GLM_ALLOW_LOCAL_FILE_DATA_URI 可关），
 *      智谱未承诺支持时返回可操作错误（提示改用公网 URL 或托管链接）。
 */

const path = require('path');
const fs = require('fs');
const config = require('./config');
const safety = require('./safety');

const URL_RE = /^https?:\/\//i;
const DATA_URI_RE = /^data:/i;
const FILE_SCHEME_RE = /^file:\/\//i;

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.avif', '.heic']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.flv', '.ts', '.wmv', '.mpeg', '.mpg', '.3gp']);
const FILE_EXT = new Set(['.pdf', '.txt', '.md', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.csv', '.html', '.json', '.tex', '.epub']);

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.heic': 'image/heic',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.json': 'application/json',
  '.tex': 'application/x-tex',
  '.epub': 'application/epub+zip',
};

/** 判断 URL 类型 */
function isRemoteUrl(s) {
  return URL_RE.test(s) || FILE_SCHEME_RE.test(s) || DATA_URI_RE.test(s);
}

function isDataUri(s) {
  return DATA_URI_RE.test(s);
}

function extOf(p) {
  const ext = path.extname(p).toLowerCase();
  return ext || '';
}

/** 由扩展名推断 media_type */
function typeByExt(ext) {
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  if (FILE_EXT.has(ext)) return 'file';
  return 'file'; // 未知扩展名按 file 处理，由模型/接口兜底
}

/**
 * 解析用户 source + media_type 请求。
 * @param {string} source 本地路径或 URL
 * @param {string} mediaType auto|image|video|file
 * @param {string[]} extraAllowedDirs 额外允许目录（当前工作区）
 * @returns {{ok:true, media_type:string, url:string|null, data_uri:boolean, local:boolean, name:string, size:number|null, privacy_notice:boolean}|{ok:false,code:string,reason:string}}
 */
function resolveSource(source, mediaType, extraAllowedDirs = []) {
  if (typeof source !== 'string' || !source.trim()) {
    return { ok: false, code: 'INVALID_SOURCE', reason: '参数 source 不能为空' };
  }
  const src = source.trim();

  // ---------- 远程 URL / data URI ----------
  if (isRemoteUrl(src)) {
    if (isDataUri(src)) {
      return {
        ok: false,
        code: 'DATA_URI_NOT_SUPPORTED',
        reason: 'MCP 不接受调用方直接传 data URI（避免绕过本地路径安全检查）。请传本地路径或公网 http(s) URL。',
      };
    }
    if (FILE_SCHEME_RE.test(src)) {
      // file:// 协议：转成本地路径走安全校验
      return resolveSource(fileUrlToPath(src), mediaType, extraAllowedDirs);
    }
    const ext = extOf(new URL(src).pathname);
    const inferred = typeByExt(ext);
    const mt = mediaType && mediaType !== 'auto' ? mediaType : inferred;
    return {
      ok: true,
      media_type: mt,
      url: src,
      data_uri: false,
      local: false,
      name: src.split('/').pop() || 'remote',
      size: null,
      privacy_notice: false, // 远程 URL 本身是用户/宿主提供，不属于"首次上传本地文件"
    };
  }

  // ---------- 本地路径 ----------
  const allowed = resolveAllowedPathOrThrow(src, extraAllowedDirs);
  if (!allowed.ok) return allowed;

  const { resolved, stat } = allowed;
  const ext = extOf(resolved);
  const inferred = typeByExt(ext);
  const mt = mediaType && mediaType !== 'auto' ? mediaType : inferred;

  if (mt === 'image') {
    // 本地图片 → Base64 data URL（官方支持）
    const check = safety.readFileBytes(resolved, config.maxImageBytes);
    if (!check.ok) return check;
    const mime = MIME_BY_EXT[ext] || 'image/png';
    const dataUri = `data:${mime};base64,${check.bytes.toString('base64')}`;
    return {
      ok: true,
      media_type: 'image',
      url: dataUri,
      data_uri: true,
      local: true,
      name: path.basename(resolved),
      size: check.size,
      privacy_notice: true,
    };
  }

  if (mt === 'video') {
    if (!config.allowLocalVideoDataUri) {
      return {
        ok: false,
        code: 'LOCAL_VIDEO_NOT_SUPPORTED',
        reason:
          '当前配置不允许本地视频以 data URI 上传（GLM_ALLOW_LOCAL_VIDEO_DATA_URI=false）。' +
          '智谱官方未承诺支持本地视频直传，请将视频上传为公网 URL（如对象存储/图床）后传 URL，或开启该配置。',
      };
    }
    const check = safety.readFileBytes(resolved, config.maxVideoBytes);
    if (!check.ok) return check;
    const mime = MIME_BY_EXT[ext] || 'video/mp4';
    const dataUri = `data:${mime};base64,${check.bytes.toString('base64')}`;
    return {
      ok: true,
      media_type: 'video',
      url: dataUri,
      data_uri: true,
      local: true,
      name: path.basename(resolved),
      size: check.size,
      privacy_notice: true,
    };
  }

  // file（PDF/文档等）
  if (!config.allowLocalFileDataUri) {
    return {
      ok: false,
      code: 'LOCAL_FILE_NOT_SUPPORTED',
      reason:
        '当前配置不允许本地文件以 data URI 上传（GLM_ALLOW_LOCAL_FILE_DATA_URI=false）。' +
        '智谱官方未承诺支持本地文件直传，请将文件上传为公网 URL 后传 URL，或开启该配置。',
    };
  }
  const check = safety.readFileBytes(resolved, config.maxFileBytes);
  if (!check.ok) return check;
  const mime = MIME_BY_EXT[ext] || 'application/octet-stream';
  const dataUri = `data:${mime};base64,${check.bytes.toString('base64')}`;
  return {
    ok: true,
    media_type: 'file',
    url: dataUri,
    data_uri: true,
    local: true,
    name: path.basename(resolved),
    size: check.size,
    privacy_notice: true,
  };
}

function resolveAllowedPathOrThrow(src, extra) {
  const r = safety.resolveAllowedPath(src, extra);
  if (!r.ok) return r;
  return r;
}

/** file:// 协议 → 本地路径 */
function fileUrlToPath(u) {
  const url = new URL(u);
  if (process.platform === 'win32') {
    // file:///C:/a/b → C:\a\b
    return decodeURIComponent(url.pathname).replace(/^\//, '').replace(/\//g, path.sep);
  }
  return decodeURIComponent(url.pathname);
}

module.exports = {
  resolveSource,
  isRemoteUrl,
  isDataUri,
  typeByExt,
  extOf,
  IMAGE_EXT,
  VIDEO_EXT,
  FILE_EXT,
  MIME_BY_EXT,
};
