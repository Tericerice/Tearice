'use strict';
/**
 * mcp.test.js — MCP 端到端测试（stdio 子进程）
 * 覆盖：握手、工具列表、图片/视频/文件完整调用、参数校验、无 Key、敏感文件、provider 错误、返回结构。
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MockZhipuServer, sequenceScenario, startMCPClient } = require('./helpers');

test('mcp suite', async (t) => {
const PROJECT_TMP = path.join(__dirname, '.tmp');
fs.mkdirSync(PROJECT_TMP, { recursive: true });

let mock;
let client;

// 每个子测试共享的 mock 智谱服务 + MCP 客户端（子测试默认串行）
mock = new MockZhipuServer();
await mock.start();
client = await startMCPClient({ endpoint: mock.endpoint });
t.after(async () => {
  if (client) client.kill();
  await mock.close();
});

const OK_IMAGE_CONTENT =
  '图片是一张公司月度经营报表截图。顶部标题为"2026 年 7 月经营月报"，用 [[120,80,520,140]] 标注。' +
  '中间表格 Q2 环比 +12%，第 3 行显示收入 ¥1,234 万（可见文字，非推断）。';

const OK_VIDEO_CONTENT =
  '视频前 30 秒是产品演示，[00:05] 展示登录界面，[00:18] 进入数据看板，[00:27] 出现导出按钮。' +
  '总体为教程型内容，无异常画面。';

const OK_FILE_CONTENT =
  '文档共 12 页。第 1 页为封面，[p.1]。核心结论在第 3 页表格：毛利率 42%，[p.3]。' +
  '第 5 页图表显示成本下降趋势，[p.5]。';



function makeLocalFile(name, bytes) {
  const f = path.join(PROJECT_TMP, name);
  fs.writeFileSync(f, Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
  return f;
}

/** 在系统临时目录创建文件（子进程严格模式下应被拒绝） */
function makeOutsideFile(name, bytes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glm-outside-'));
  const f = path.join(dir, name);
  fs.writeFileSync(f, Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
  return f;
}

/** 解析 MCP 工具返回的 text JSON */
function parseResult(res) {
  assert.ok(res.content && res.content[0] && res.content[0].type === 'text');
  return JSON.parse(res.content[0].text);
}

  await t.test('MCP 握手：initialize 返回正确服务信息', async () => {
    client = await startMCPClient({ endpoint: mock.endpoint });
    assert.strictEqual(client.result.serverInfo.name, 'glm-vision-mcp');
    assert.ok(client.result.capabilities.tools);
    assert.ok(client.result.protocolVersion);
});

  await t.test('工具列表：包含 glm_vision_analyze 且 schema 完整', async () => {
    const res = await client.request('tools/list', {});
    const names = res.tools.map((t) => t.name);
    assert.ok(names.includes('glm_vision_analyze'));
    const tool = res.tools.find((t) => t.name === 'glm_vision_analyze');
    assert.ok(tool.description.includes('GLM-4.6V-Flash'));
    const props = tool.inputSchema.properties;
    assert.ok(props.source && props.prompt && props.media_type);
    assert.ok(Array.isArray(props.media_type.enum));
});

  await t.test('图片完整调用：本地 PNG → data URI → mock 返回 → 结构化结果', async () => {
    mock.handler = () => mock.okResponse(OK_IMAGE_CONTENT);
    const img = makeLocalFile('monthly-report.png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const res = await client.request('tools/call', {
      name: 'glm_vision_analyze',
      arguments: {
        source: img,
        prompt: '这是什么？总结画面内容',
      },
    });
    assert.strictEqual(res.isError, undefined);
  
    // 请求体断言：image_url + data URI + 单一模态
    const body = mock.lastRequestBody();
    assert.strictEqual(body.messages[0].content[0].type, 'image_url');
    assert.ok(body.messages[0].content[0].image_url.url.startsWith('data:image/png;base64,'));
    assert.strictEqual(body.model, 'glm-4.6v-flash');
  
    // 返回结构断言
    const r = parseResult(res);
    assert.strictEqual(r.model, 'glm-4.6v-flash');
    assert.strictEqual(r.media_type, 'image');
    assert.ok(r.answer.includes('经营月报'));
    assert.ok(Array.isArray(r.evidence));
    assert.ok(['high', 'medium', 'low'].includes(r.confidence));
    assert.ok(Array.isArray(r.warnings));
    assert.ok(r.meta && typeof r.meta.latency_ms === 'number');
    assert.ok(r.privacy_notice.includes('发送给智谱 AI'));
    // evidence 应包含 region（模型输出含 [[x,y,x,y]]）
    assert.ok(r.evidence.some((e) => e.region));
});

  await t.test('视频完整调用：本地 MP4 → video_url + 时间戳证据', async () => {
    mock.handler = () => mock.okResponse(OK_VIDEO_CONTENT);
    const vid = makeLocalFile('demo.mp4', 'fake-mp4');
    const res = await client.request('tools/call', {
      name: 'glm_vision_analyze',
      arguments: {
        source: vid,
        prompt: '总结视频内容，带时间戳',
        timestamp_hint: '00:00-00:30',
      },
    });
    assert.strictEqual(res.isError, undefined);
    const body = mock.lastRequestBody();
    assert.strictEqual(body.messages[0].content[0].type, 'video_url');
    assert.ok(body.messages[0].content[0].video_url.url.startsWith('data:video/mp4;base64,'));
    assert.ok(body.messages[0].content[1].text.includes('00:00-00:30'));
  
    const r = parseResult(res);
    assert.strictEqual(r.media_type, 'video');
    assert.ok(r.evidence.some((e) => e.timestamp === '00:05'));
});

  await t.test('PDF 完整调用：本地 PDF → file_url + 页码证据', async () => {
    mock.handler = () => mock.okResponse(OK_FILE_CONTENT);
    const pdf = makeLocalFile('report.pdf', '%PDF-1.4 fake body');
    const res = await client.request('tools/call', {
      name: 'glm_vision_analyze',
      arguments: {
        source: pdf,
        prompt: '提取关键信息',
      },
    });
    assert.strictEqual(res.isError, undefined);
    const body = mock.lastRequestBody();
    assert.strictEqual(body.messages[0].content[0].type, 'file_url');
    assert.ok(body.messages[0].content[0].file_url.url.startsWith('data:application/pdf;base64,'));
    const r = parseResult(res);
    assert.strictEqual(r.media_type, 'file');
    assert.ok(r.evidence.some((e) => e.page === 3));
});

  await t.test('图片 URL 调用：直接透传公网 URL', async () => {
    mock.handler = () => mock.okResponse('一张风景照');
    const res = await client.request('tools/call', {
      name: 'glm_vision_analyze',
      arguments: {
        source: 'https://cdn.example.com/photo.png',
        prompt: '描述一下',
      },
    });
    assert.strictEqual(res.isError, undefined);
    const body = mock.lastRequestBody();
    assert.strictEqual(body.messages[0].content[0].image_url.url, 'https://cdn.example.com/photo.png');
    const r = parseResult(res);
    assert.strictEqual(r.privacy_notice, undefined); // 远程 URL 无隐私提示
});

  await t.test('缺失参数：source 缺失 → isError', async () => {
    const res = await client.request('tools/call', {
      name: 'glm_vision_analyze',
      arguments: { prompt: '看看' },
    });
    assert.strictEqual(res.isError, true);
    assert.ok(res.content[0].text.includes('source'));
});

  await t.test('缺失参数：prompt 缺失 → isError', async () => {
    const res = await client.request('tools/call', {
      name: 'glm_vision_analyze',
      arguments: { source: 'x.png' },
    });
    assert.strictEqual(res.isError, true);
    assert.ok(res.content[0].text.includes('prompt'));
});

  await t.test('非法 media_type → isError', async () => {
    const res = await client.request('tools/call', {
      name: 'glm_vision_analyze',
      arguments: { source: 'x.png', prompt: 'p', media_type: 'audio' },
    });
    assert.strictEqual(res.isError, true);
    assert.ok(res.content[0].text.includes('media_type'));
});

  await t.test('敏感文件拒绝：.env → isError + SENSITIVE_PATH', async () => {
    const f = makeLocalFile('.env', 'ZHIPU_API_KEY=xxx');
    const res = await client.request('tools/call', {
      name: 'glm_vision_analyze',
      arguments: { source: f, prompt: 'p' },
    });
    assert.strictEqual(res.isError, true);
    assert.ok(res.content[0].text.includes('SENSITIVE_PATH'));
});

  await t.test('目录外路径拒绝：→ PATH_NOT_ALLOWED', async () => {
    const f = makeOutsideFile('outside.png', 'x');
    const res = await client.request('tools/call', {
      name: 'glm_vision_analyze',
      arguments: { source: f, prompt: 'p' },
    });
    assert.strictEqual(res.isError, true);
    assert.ok(res.content[0].text.includes('PATH_NOT_ALLOWED') || res.content[0].text.includes('不在允许读取的目录'));
});

  await t.test('provider 401 → isError + AUTH_FAILED（不污染堆栈）', async () => {
    mock.handler = () => mock.errorResponse(401, 'authentication_error', 'Invalid API key');
    const res = await client.request('tools/call', {
      name: 'glm_vision_analyze',
      arguments: { source: 'https://cdn.example.com/a.png', prompt: 'p' },
    });
    assert.strictEqual(res.isError, true);
    assert.ok(res.content[0].text.includes('AUTH_FAILED'));
    assert.ok(!res.content[0].text.includes('at ')); // 不包含堆栈
});

  await t.test('provider 429（重试后仍失败）→ isError + RATE_LIMITED', async () => {
    mock.handler = () => mock.errorResponse(429, 'rate_limit_exceeded', 'busy');
    const res = await client.request('tools/call', {
      name: 'glm_vision_analyze',
      arguments: { source: 'https://cdn.example.com/a.png', prompt: 'p' },
    });
    assert.strictEqual(res.isError, true);
    assert.ok(res.content[0].text.includes('RATE_LIMITED'));
});

  await t.test('未知工具 → MethodNotFound', async () => {
    await assert.rejects(
      client.request('tools/call', { name: 'no_such_tool', arguments: {} }),
      (e) => String(e).includes('-32601') || String(e).includes('未知工具')
    );
  });

  await t.test('无 API Key → isError + NO_API_KEY', async () => {
    if (client) client.kill();
    client = await startMCPClient({ apiKey: '', endpoint: mock.endpoint });
    const res = await client.request('tools/call', {
      name: 'glm_vision_analyze',
      arguments: { source: 'https://cdn.example.com/a.png', prompt: 'p' },
    });
    assert.strictEqual(res.isError, true);
    assert.ok(res.content[0].text.includes('NO_API_KEY'));
});
});
