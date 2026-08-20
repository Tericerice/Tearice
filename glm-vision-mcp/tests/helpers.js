'use strict';
/**
 * helpers.js — 测试基础设施
 *  1. MockZhipuServer：本地 HTTP 服务器模拟智谱 chat/completions（图片/视频/文件/错误场景）
 *  2. SpawnMCPClient：以子进程方式启动 server.js，走 stdio JSON-RPC 完成握手与工具调用
 */

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const { once } = require('events');

const SERVER_PATH = path.resolve(__dirname, '..', 'server.js');

/** 记录每次请求（用于断言请求体） */
class MockZhipuServer {
  constructor() {
    this.requests = [];
    this.handler = null; // 由 setScenario 设置
  }

  async start() {
    this.server = http.createServer(async (req, res) => {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = raw ? JSON.parse(raw) : {};
      this.requests.push({ method: req.method, url: req.url, body });
      const resp = await this.handler(body);
      res.writeHead(resp.status || 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(resp.json || {}));
    });
    this.server.listen(0, '127.0.0.1');
    await once(this.server, 'listening');
    this.port = this.server.address().port;
    this.endpoint = `http://127.0.0.1:${this.port}/api/paas/v4/chat/completions`;
    return this;
  }

  async close() {
    if (this.server) this.server.close();
  }

  lastRequestBody() {
    return this.requests.length ? this.requests[this.requests.length - 1].body : null;
  }

  /** 标准成功响应（按 media 类型回填不同内容） */
  okResponse(content, extra = {}) {
    return {
      status: 200,
      json: {
        id: 'mock-' + Math.random().toString(16).slice(2),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'glm-4.6v-flash',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        ...extra,
      },
    };
  }

  errorResponse(status, code, message) {
    return {
      status,
      json: { error: { code, message, type: 'mock_error' } },
    };
  }
}

/** 场景：一次可变的响应序列（支持"先 429 再成功"等重试测试） */
function sequenceScenario(...steps) {
  let i = 0;
  return () => {
    const s = steps[Math.min(i, steps.length - 1)];
    i += 1;
    return s;
  };
}

/** 启动 MCP server 子进程，注入环境变量 */
async function startMCPClient({ apiKey = 'test-key', endpoint, env = {}, argv = [] } = {}) {
  const child = spawn(process.execPath, [SERVER_PATH, ...argv], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      ZHIPU_API_KEY: apiKey,
      GLM_CHAT_ENDPOINT: endpoint,
      GLM_PRIVACY_NOTICE: 'true',
      GLM_ALLOW_TMP: 'false', // 严格模式：子进程内临时目录默认不可读（测试文件放项目目录）
      ...env,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stderrBuf = '';
  child.stderr.on('data', (d) => (stderrBuf += d.toString()));

  let idSeq = 0;
  const pending = new Map();
  let buf = '';

  child.stdout.on('data', (d) => {
    buf += d.toString();
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch (_) {
        continue;
      }
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    }
  });

  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++idSeq;
      pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });

  const result = await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'glm-vision-mcp-test', version: '1.0.0' },
  });
  child.stdin.write(
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'
  );

  return {
    child,
    request,
    result,
    stderr: () => stderrBuf,
    kill: () => child.kill(),
  };
}

module.exports = {
  MockZhipuServer,
  sequenceScenario,
  startMCPClient,
  SERVER_PATH,
};
