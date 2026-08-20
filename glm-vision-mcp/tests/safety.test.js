'use strict';
/**
 * safety.test.js — 路径安全与敏感文件检测
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const safety = require('../lib/safety');
const config = require('../lib/config');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glm-safety-'));

test('拒绝敏感文件：.env', () => {
  const r = safety.resolveAllowedPath(path.join(tmpDir, 'project', '.env'));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'SENSITIVE_PATH');
});

test('拒绝敏感文件：私钥', () => {
  const r = safety.resolveAllowedPath(path.join(tmpDir, 'id_rsa'));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'SENSITIVE_PATH');
});

test('拒绝浏览器 Profile 目录', () => {
  const r = safety.resolveAllowedPath(path.join(tmpDir, 'profile', 'Default', 'Login Data'));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'SENSITIVE_PATH');
});

test('拒绝不存在的路径', () => {
  const r = safety.resolveAllowedPath(path.join(tmpDir, 'no-such-file.png'));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'NOT_FOUND');
});

test('允许临时目录内的普通文件', () => {
  const f = path.join(tmpDir, 'ok.png');
  fs.writeFileSync(f, 'x');
  const r = safety.resolveAllowedPath(f);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.resolved, path.resolve(f));
});

test('拒绝允许目录之外的文件', () => {
  const f = path.join(tmpDir, 'outside.png');
  fs.writeFileSync(f, 'x');
  // 严格模式：关闭临时目录授权，此时 tmpDir 下的文件应在允许集合之外
  config.allowTmpDir = false;
  try {
    const r = safety.resolveAllowedPath(f, [path.join(tmpDir, 'other')]);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'PATH_NOT_ALLOWED');
  } finally {
    config.allowTmpDir = true;
  }
});

test('readFileBytes 超限检测', () => {
  const f = path.join(tmpDir, 'big.bin');
  fs.writeFileSync(f, Buffer.alloc(1024));
  const r = safety.readFileBytes(f, 100);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'FILE_TOO_LARGE');
});
