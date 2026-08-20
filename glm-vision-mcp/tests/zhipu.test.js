'use strict';
/**
 * zhipu.test.js — 智谱调用：成功路径、错误转换、限流重试、超时、网络失败
 *
 * 注意：
 *  - node:test 每个文件独立进程，顶部设置 env 后 require 模块是安全的；
 *  - 所有用例放在父测试（suite）内，子测试默认串行，避免共享 mock server 的 handler 互相污染。
 */

process.env.ZHIPU_API_KEY = 'test-key';

const { test } = require('node:test');
const assert = require('node:assert');
const zhipu = require('../lib/zhipu');
const { MockZhipuServer, sequenceScenario } = require('./helpers');

const OK_CONTENT =
  '画面中有一张红色卡片，标注"2026 年销售数据"，左上角图表上升趋势。' +
  '[[120,300,420,360]] 区域是标题。第 3 页表格显示 Q2 环比 +12%。时间点 [00:12] 出现关键转折。';

test('zhipu suite', async (t) => {
  const mock = new MockZhipuServer();
  await mock.start();
  t.after(async () => {
    await mock.close();
  });

  await t.test('成功调用：返回 content/usage/latencyMs，请求体含 image_url + data URI + thinking disabled', async () => {
    mock.handler = () => mock.okResponse(OK_CONTENT);
    const out = await zhipu.callZhipu({
      mediaType: 'image',
      mediaUrl: 'data:image/png;base64,AAAA',
      prompt: '总结这张图',
      thinking: false,
      responseFormat: 'text',
      timeoutMs: 5000,
      endpoint: mock.endpoint,
    });
    assert.ok(out.content.includes('红色卡片'));
    assert.ok(out.usage.total_tokens > 0);
    assert.ok(out.latencyMs >= 0);

    const body = mock.lastRequestBody();
    assert.strictEqual(body.model, 'glm-4.6v-flash');
    assert.strictEqual(body.messages[0].content[0].type, 'image_url');
    assert.strictEqual(body.messages[0].content[0].image_url.url, 'data:image/png;base64,AAAA');
    assert.strictEqual(body.thinking.type, 'disabled');
    assert.strictEqual(body.messages[0].content[1].text, '总结这张图');
  });

  await t.test('成功调用：video_url 内容块 + thinking enabled', async () => {
    mock.handler = () => mock.okResponse(OK_CONTENT);
    await zhipu.callZhipu({
      mediaType: 'video',
      mediaUrl: 'https://cdn.example.com/a.mp4',
      prompt: '总结',
      thinking: true,
      responseFormat: 'text',
      timeoutMs: 5000,
      endpoint: mock.endpoint,
    });
    const body = mock.lastRequestBody();
    assert.strictEqual(body.messages[0].content[0].type, 'video_url');
    assert.strictEqual(body.messages[0].content[0].video_url.url, 'https://cdn.example.com/a.mp4');
    assert.strictEqual(body.thinking.type, 'enabled');
  });

  await t.test('成功调用：file_url 内容块 + json 模式', async () => {
    mock.handler = () => mock.okResponse('{"answer":"OK"}');
    await zhipu.callZhipu({
      mediaType: 'file',
      mediaUrl: 'data:application/pdf;base64,QUJD',
      prompt: '解析',
      thinking: false,
      responseFormat: 'json',
      timeoutMs: 5000,
      endpoint: mock.endpoint,
    });
    const body = mock.lastRequestBody();
    assert.strictEqual(body.messages[0].content[0].type, 'file_url');
    assert.deepStrictEqual(body.response_format, { type: 'json_object' });
  });

  await t.test('401 → AUTH_FAILED，不重试', async () => {
    mock.requests.length = 0;
    mock.handler = () => mock.errorResponse(401, 'authentication_error', 'Invalid API key');
    await assert.rejects(
      zhipu.callZhipu({ mediaType: 'image', mediaUrl: 'x', prompt: 'p', timeoutMs: 5000, endpoint: mock.endpoint }),
      (e) => e instanceof zhipu.ProviderError && e.code === 'AUTH_FAILED' && !e.meta.retryable
    );
    assert.strictEqual(mock.requests.length, 1);
  });

  await t.test('429 一次后成功：自动重试 1 次', async () => {
    mock.requests.length = 0;
    mock.handler = sequenceScenario(
      mock.errorResponse(429, 'rate_limit_exceeded', 'Too many requests'),
      mock.okResponse(OK_CONTENT)
    );
    const out = await zhipu.callZhipu({
      mediaType: 'image',
      mediaUrl: 'x',
      prompt: 'p',
      timeoutMs: 5000,
      endpoint: mock.endpoint,
    });
    assert.ok(out.content.length > 0);
    assert.strictEqual(mock.requests.length, 2);
  });

  await t.test('500 一次后成功：自动重试 1 次', async () => {
    mock.requests.length = 0;
    mock.handler = sequenceScenario(
      mock.errorResponse(500, 'internal_error', 'boom'),
      mock.okResponse(OK_CONTENT)
    );
    const out = await zhipu.callZhipu({
      mediaType: 'image',
      mediaUrl: 'x',
      prompt: 'p',
      timeoutMs: 5000,
      endpoint: mock.endpoint,
    });
    assert.ok(out.content.length > 0);
    assert.strictEqual(mock.requests.length, 2);
  });

  await t.test('持续 429 → RATE_LIMITED，最多尝试 3 次（禁止无限重试）', async () => {
    mock.requests.length = 0;
    mock.handler = () => mock.errorResponse(429, 'rate_limit_exceeded', 'busy');
    await assert.rejects(
      zhipu.callZhipu({ mediaType: 'image', mediaUrl: 'x', prompt: 'p', timeoutMs: 5000, endpoint: mock.endpoint }),
      (e) => e.code === 'RATE_LIMITED'
    );
    // 1 + GLM_MAX_RETRIES(2) = 3
    assert.strictEqual(mock.requests.length, 3);
  });

  await t.test('404 → MODEL_NOT_FOUND', async () => {
    mock.handler = () => mock.errorResponse(404, 'model_not_found', 'model does not exist');
    await assert.rejects(
      zhipu.callZhipu({ mediaType: 'image', mediaUrl: 'x', prompt: 'p', timeoutMs: 5000, endpoint: mock.endpoint }),
      (e) => e.code === 'MODEL_NOT_FOUND'
    );
  });

  await t.test('超时 → TIMEOUT', async () => {
    mock.handler = () =>
      new Promise((resolve) => {
        setTimeout(() => resolve(mock.okResponse('late')), 3000);
      });
    await assert.rejects(
      zhipu.callZhipu({ mediaType: 'image', mediaUrl: 'x', prompt: 'p', timeoutMs: 300, endpoint: mock.endpoint }),
      (e) => e.code === 'TIMEOUT'
    );
  });

  await t.test('网络失败（连接被拒）→ NETWORK_ERROR，重试后仍失败', async () => {
    await assert.rejects(
      zhipu.callZhipu({
        mediaType: 'image',
        mediaUrl: 'x',
        prompt: 'p',
        timeoutMs: 2000,
        endpoint: 'http://127.0.0.1:1/unreachable',
      }),
      (e) => e.code === 'NETWORK_ERROR'
    );
  });
});
