'use strict';
/**
 * source.test.js — source 解析（URL / 本地路径 / 类型推断 / data URI）
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const source = require('../lib/source');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glm-source-'));

test('公网图片 URL → image', () => {
  const r = source.resolveSource('https://cdn.example.com/a.png', 'auto');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.media_type, 'image');
  assert.strictEqual(r.data_uri, false);
  assert.strictEqual(r.privacy_notice, false);
});

test('公网视频 URL → video', () => {
  const r = source.resolveSource('https://cdn.example.com/v.mp4', 'auto');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.media_type, 'video');
});

test('公网 PDF URL → file', () => {
  const r = source.resolveSource('https://cdn.example.com/doc.pdf', 'auto');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.media_type, 'file');
});

test('data URI 被拒绝（防绕过安全校验）', () => {
  const r = source.resolveSource('data:image/png;base64,AAAA', 'auto');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'DATA_URI_NOT_SUPPORTED');
});

test('本地图片 → base64 data URI', () => {
  const f = path.join(tmpDir, 'pic.png');
  fs.writeFileSync(f, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const r = source.resolveSource(f, 'auto');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.media_type, 'image');
  assert.strictEqual(r.data_uri, true);
  assert.strictEqual(r.local, true);
  assert.ok(r.url.startsWith('data:image/png;base64,'));
  assert.strictEqual(r.privacy_notice, true);
});

test('本地视频 → data URI（配置开启时）', () => {
  const f = path.join(tmpDir, 'clip.mp4');
  fs.writeFileSync(f, Buffer.from('fake-mp4-bytes'));
  const r = source.resolveSource(f, 'auto');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.media_type, 'video');
  assert.ok(r.url.startsWith('data:video/mp4;base64,'));
});

test('本地 PDF → data URI（配置开启时）', () => {
  const f = path.join(tmpDir, 'doc.pdf');
  fs.writeFileSync(f, Buffer.from('%PDF-1.4 fake'));
  const r = source.resolveSource(f, 'auto');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.media_type, 'file');
  assert.ok(r.url.startsWith('data:application/pdf;base64,'));
});

test('media_type 显式指定优先于扩展名推断', () => {
  const f = path.join(tmpDir, 'data.bin');
  fs.writeFileSync(f, Buffer.from('x'));
  const r = source.resolveSource(f, 'image');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.media_type, 'image');
});

test('file:// 协议转为本地路径并走安全校验', () => {
  const f = path.join(tmpDir, 'viafile.png');
  fs.writeFileSync(f, Buffer.from('x'));
  const url = 'file:///' + f.replace(/\\/g, '/');
  const r = source.resolveSource(url, 'auto');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.media_type, 'image');
});
