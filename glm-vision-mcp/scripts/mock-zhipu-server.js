'use strict';
/**
 * mock-zhipu-server.js — 独立智谱 mock 服务器（供演示与联调，无需真实 Key）
 *
 * 用法：
 *   node scripts/mock-zhipu-server.js [port]
 *
 * 默认端口 9876，endpoint: http://127.0.0.1:9876/api/paas/v4/chat/completions
 * 对任意请求返回模拟的视觉分析结果（按内容块类型给出不同示例答案）。
 */

const http = require('http');

const port = parseInt(process.argv[2] || process.env.PORT || '9876', 10);

const ANSWERS = {
  image_url:
    '图片分析（mock）：画面为一张报表截图，标题"2026 年 7 月经营月报"，用 [[120,80,520,140]] 标注；' +
    '表格 Q2 环比 +12%，收入 ¥1,234 万。[00:12] 出现关键转折。',
  video_url:
    '视频分析（mock）：教程型内容。[00:05] 展示登录界面，[00:18] 进入数据看板，[00:27] 出现导出按钮。',
  file_url:
    '文档分析（mock）：共 12 页，[p.1] 封面；[p.3] 表格：毛利率 42%；[p.5] 图表显示成本下降趋势。',
};

const server = http.createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  let body = {};
  try {
    body = JSON.parse(raw);
  } catch (_) {
    /* ignore */
  }
  const content = body && body.messages && body.messages[0] && body.messages[0].content;
  const first = Array.isArray(content) ? content.find((c) => c && c.type && ANSWERS[c.type]) : null;
  const answer = first ? ANSWERS[first.type] : '分析结果（mock）：无法识别媒体类型。';
  const ts = new Date().toISOString();

  const json = {
    id: 'mock-' + Math.floor(Math.random() * 1e9),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: (body && body.model) || 'glm-4.6v-flash',
    choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 60, total_tokens: 160 },
  };
  console.log(`[${ts}] ${req.method} ${req.url} → 200 (${first ? first.type : '?'})`);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(json));
});

server.listen(port, '127.0.0.1', () => {
  console.log(`mock zhipu listening on http://127.0.0.1:${port}/api/paas/v4/chat/completions`);
});
