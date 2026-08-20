'use strict';
/**
 * test-real.js — 真实集成测试（需要有效 ZHIPU_API_KEY）
 *
 * 用法：
 *   node scripts/test-real.js --source <路径或URL> [--prompt <分析要求>] [--media image|video|file] [--thinking]
 *
 * 示例：
 *   node scripts/test-real.js --source samples/ocr-sample.png --prompt "识别图中所有文字"
 *   node scripts/test-real.js --source samples/sample-clip.mp4 --prompt "总结视频内容，带时间戳"
 *   node scripts/test-real.js --source samples/sample-doc.pdf --prompt "提取关键内容，注明页码"
 */

const path = require('path');
const config = require('../lib/config');
const source = require('../lib/source');
const zhipu = require('../lib/zhipu');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--source') args.source = argv[++i];
    else if (a === '--prompt') args.prompt = argv[++i];
    else if (a === '--media') args.media = argv[++i];
    else if (a === '--thinking') args.thinking = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.source) {
    console.error('用法: node scripts/test-real.js --source <路径|URL> [--prompt "要求"] [--media image|video|file] [--thinking]');
    process.exit(2);
  }
  if (!config.hasApiKey) {
    console.error('[NO_API_KEY] 未检测到 ZHIPU_API_KEY。请先设置环境变量或项目 .env（参考 .env.example）。');
    process.exit(2);
  }

  const prompt = args.prompt || '请分析这个媒体内容，给出结论、关键证据；视频给时间戳，文档给页码，图片 OCR 给区域。';
  const mediaType = args.media || 'auto';

  console.log(`解析来源: ${args.source} (media_type=${mediaType})`);
  const rs = source.resolveSource(args.source, mediaType, [process.cwd(), path.resolve(__dirname, '..')]);
  if (!rs.ok) {
    console.error(`[${rs.code}] ${rs.reason}`);
    process.exit(2);
  }
  console.log(`  媒体类型: ${rs.media_type} | data_uri: ${rs.data_uri} | 大小: ${rs.size || 'N/A'} 字节`);
  if (rs.privacy_notice) {
    console.log(`  ⚠ ${rs.privacy_notice}`);
  }

  const timeoutMs = rs.media_type === 'image' ? config.imageTimeoutMs : config.requestTimeoutMs;
  console.log(`调用 ${config.model} ...`);
  const t0 = Date.now();
  const out = await zhipu.callZhipu({
    mediaType: rs.media_type,
    mediaUrl: rs.url,
    prompt,
    thinking: Boolean(args.thinking),
    responseFormat: 'text',
    timeoutMs,
  });

  console.log(`\n===== 模型回答（${Date.now() - t0}ms, ${out.usage ? out.usage.total_tokens : '?'} tokens）=====`);
  console.log(out.content);
  console.log('\n===== 完成 =====');
}

main().catch((e) => {
  if (e instanceof zhipu.ProviderError) {
    console.error(`[${e.code}] ${e.message}`);
    process.exit(1);
  }
  console.error('失败:', e && e.message ? e.message : e);
  process.exit(1);
});
