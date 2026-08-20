'use strict';
/**
 * server.js — GLM 视觉理解 MCP Server（stdio）
 *
 * 工具：glm_vision_analyze
 *  - source：图片/视频/文件的本地路径或公网 URL
 *  - media_type：auto|image|video|file
 *  - prompt：用户的视觉分析要求
 *  - thinking：可选，默认关闭
 *  - response_format：text|json
 *  - timestamp_hint：可选，视频时间范围提示
 *
 * 运行：node server.js
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  McpError,
  ErrorCode,
} = require('@modelcontextprotocol/sdk/types.js');

const config = require('./lib/config');
const source = require('./lib/source');
const zhipu = require('./lib/zhipu');
const gemini = require('./lib/gemini');

const server = new Server(
  {
    name: config.serverName,
    version: config.version,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

/** 工具定义 */
const GLM_VISION_ANALYZE = {
  name: 'glm_vision_analyze',
  description:
    '多后端视觉分析工具：默认智谱 GLM-4.6V-Flash（图片/视频/PDF/文档），可选 Google Gemini（图片，OpenAI 兼容端点）。' +
    '适用于：看懂截图/照片/界面、OCR 读取文字、总结视频画面、解析 PDF/图表/表格、找画面重点等。' +
    '返回结构化结果：answer（结论）、evidence（时间戳/页码/区域证据）、confidence（置信度）、warnings。' +
    '注意：一次调用只支持单一媒体类型；本地图片自动转 Base64；本地视频/文件优先用公网 URL，必要时以 data URI 尝试。' +
    'provider 参数：auto（默认，GLM 优先，限流自动回退 Gemini）/ glm / gemini（仅图片）。',
  inputSchema: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        description: '本地文件路径（绝对路径，需在允许目录内）或 http(s) 公网 URL。',
      },
      media_type: {
        type: 'string',
        enum: ['auto', 'image', 'video', 'file'],
        default: 'auto',
        description: '媒体类型：auto 自动按扩展名/内容推断；明确指定可避免歧义。',
      },
      prompt: {
        type: 'string',
        description: '用户的视觉分析要求（支持中文/英文），例如："识别图中所有文字并给出区域"、"总结视频内容并给时间戳"、"提取 PDF 第 3 页的表格"。',
      },
      thinking: {
        type: 'boolean',
        default: false,
        description: '开启复杂推理（如数学题、逻辑推断）。默认关闭以节省额度。',
      },
      response_format: {
        type: 'string',
        enum: ['text', 'json'],
        default: 'text',
        description: '输出格式。json 时要求模型输出 JSON（部分模型可能不支持，将降级为 text 并记录 warning）。',
      },
      timestamp_hint: {
        type: 'string',
        description: '视频分析的时间范围提示，例如 "00:00-01:30" 或 "只看最后 10 秒"。',
      },
      provider: {
        type: 'string',
        enum: ['auto', 'glm', 'gemini'],
        default: 'auto',
        description:
          '后端模型：glm=智谱 GLM-4.6V-Flash；gemini=Google Gemini（仅支持图片）；auto=优先 GLM，限流/5xx/无 Key 时自动回退 Gemini（图片）。',
      },
    },
    required: ['source', 'prompt'],
  },
};

/** 校验并规范化参数 */
function validateArgs(args) {
  if (!args || typeof args !== 'object') {
    throw new McpError(ErrorCode.InvalidParams, '参数必须是对象');
  }
  if (typeof args.source !== 'string' || !args.source.trim()) {
    throw new McpError(ErrorCode.InvalidParams, '缺少必填参数 source（本地路径或公网 URL）');
  }
  if (typeof args.prompt !== 'string' || !args.prompt.trim()) {
    throw new McpError(ErrorCode.InvalidParams, '缺少必填参数 prompt（视觉分析要求）');
  }
  if (args.prompt.trim().length > 4000) {
    throw new McpError(ErrorCode.InvalidParams, 'prompt 过长（最多 4000 字符）');
  }
  const mediaType = args.media_type || 'auto';
  if (!['auto', 'image', 'video', 'file'].includes(mediaType)) {
    throw new McpError(ErrorCode.InvalidParams, `media_type 只能是 auto/image/video/file，收到: ${mediaType}`);
  }
  const responseFormat = args.response_format || 'text';
  if (!['text', 'json'].includes(responseFormat)) {
    throw new McpError(ErrorCode.InvalidParams, `response_format 只能是 text/json，收到: ${responseFormat}`);
  }
  const thinking = Boolean(args.thinking);
  const timestampHint =
    typeof args.timestamp_hint === 'string' && args.timestamp_hint.trim()
      ? args.timestamp_hint.trim().slice(0, 200)
      : '';
  let provider = args.provider || config.defaultProvider || 'auto';
  if (!['auto', 'glm', 'gemini'].includes(provider)) {
    throw new McpError(ErrorCode.InvalidParams, `provider 只能是 auto/glm/gemini，收到: ${provider}`);
  }
  return { source: args.source.trim(), mediaType, prompt: args.prompt.trim(), thinking, responseFormat, timestampHint, provider };
}

/** 按媒体类型生成给模型的系统指令前缀 */
function buildSystemPrompt(mediaType, timestampHint, responseFormat) {
  const lines = [];
  lines.push('你是视觉理解助手，基于用户提供的媒体内容回答。严格遵守：');
  lines.push('1. 只描述媒体中实际可见的内容；推断性内容必须明确标注"(推断)"，不确定就写"不确定"。');
  lines.push('2. 不得编造画面中不存在的文字、数字或对象。');
  if (mediaType === 'video') {
    lines.push('3. 关键结论必须带时间戳，用 [MM:SS] 或 [HH:MM:SS] 标注；若指定了时间范围则只分析该范围。');
    if (timestampHint) lines.push(`   用户指定分析时间范围：${timestampHint}。`);
  } else if (mediaType === 'file') {
    lines.push('3. 涉及具体内容的结论必须带页码，用 [p.数字] 标注；表格/图表请结构化描述。');
  } else if (mediaType === 'image') {
    lines.push('3. OCR/文字识别：逐条输出识别到的文本，并尽可能给出区域坐标，用 [[x1,y1,x2,y2]] 标注（像素坐标）。');
    lines.push('4. 区分"画面直接可见信息"与"模型推断"，推断内容加"(推断)"。');
  }
  if (responseFormat === 'json') {
    lines.push('最后输出一个 JSON 对象：{"answer": "结论", "evidence": [{"timestamp": "MM:SS或null", "page": 数字或null, "region": "[[x1,y1,x2,y2]]或null", "text": "证据文本"}], "confidence": "high|medium|low", "warnings": ["..."]}');
  }
  return lines.join('\n');
}

/** 从模型输出中提取 evidence（时间戳/页码/区域） */
function extractEvidence(text, mediaType) {
  const evidence = [];
  const tStamp = /(?:\[|\s|^|\(|：)(\d{1,2}:\d{2}(?::\d{2})?)(?:\]|\s|$|\)|,|。|，)/g;
  let m;
  while ((m = tStamp.exec(text)) && evidence.length < 20) {
    evidence.push({ timestamp: m[1], page: null, region: null, text: null });
  }
  const pPage = /\[p\.\s*(\d+)\]/gi;
  while ((m = pPage.exec(text)) && evidence.length < 20) {
    evidence.push({ timestamp: null, page: parseInt(m[1], 10), region: null, text: null });
  }
  const pRegion = /\[\[(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\]\]/g;
  while ((m = pRegion.exec(text)) && evidence.length < 20) {
    evidence.push({
      timestamp: null,
      page: null,
      region: `[[${m[1]},${m[2]},${m[3]},${m[4]}]]`,
      text: null,
    });
  }
  return evidence;
}

/** 组装最终返回结构 */
function buildResult({ model, mediaType, answer, reasoning, evidence, confidence, warnings, usage, latencyMs, sourceInfo }) {
  const result = {
    model,
    media_type: mediaType,
    answer,
    evidence,
    confidence: confidence || (evidence.length > 0 ? 'medium' : 'high'),
    warnings: warnings || [],
  };
  // 额外结构化元数据
  result.meta = {
    reasoning_used: Boolean(reasoning),
    usage: usage || null,
    latency_ms: latencyMs,
    source: sourceInfo,
  };
  return result;
}

/** 主工具实现 */
async function handleAnalyze(args) {
  const { source: src, mediaType, prompt, thinking, responseFormat, timestampHint, provider } = validateArgs(args);

  // 1) 解析来源（含本地路径安全校验）
  const extraDirs = [process.cwd(), require('path').resolve(__dirname)];
  const rs = source.resolveSource(src, mediaType, extraDirs);
  if (!rs.ok) {
    throw new McpError(ErrorCode.InvalidParams, `[${rs.code}] ${rs.reason}`);
  }

  // 2) 组装 prompt（系统指令 + 用户问题）
  const sysPrompt = buildSystemPrompt(rs.media_type, timestampHint, responseFormat);
  const userPrompt = `${sysPrompt}\n\n用户问题：${prompt}`;

  // 3) 调用后端（glm / gemini / auto：GLM 优先，限流·5xx·无 Key·超时时图片自动回退 Gemini）
  const timeoutMs = rs.media_type === 'image' ? config.imageTimeoutMs : config.requestTimeoutMs;
  let out;
  let usedProvider = provider === 'gemini' ? 'gemini' : 'glm';
  let fallbackReason = null;
  const tryGemini = async () =>
    gemini.callGemini({
      mediaType: rs.media_type,
      mediaUrl: rs.url,
      prompt: userPrompt,
      thinking,
      responseFormat,
      // Gemini 走代理较慢，用独立超时（默认 120s），不受 GLM 图片超时（60s）限制
      timeoutMs: config.geminiRequestTimeoutMs,
    });
  if (provider === 'gemini') {
    out = await tryGemini();
  } else {
    try {
      out = await zhipu.callZhipu({
        mediaType: rs.media_type,
        mediaUrl: rs.url,
        prompt: userPrompt,
        thinking,
        responseFormat,
        timeoutMs,
      });
    } catch (e) {
      const canFallback =
        provider === 'auto' &&
        e instanceof zhipu.ProviderError &&
        rs.media_type === 'image' &&
        config.geminiHasApiKey &&
        ['RATE_LIMITED', 'PROVIDER_ERROR', 'NO_API_KEY', 'TIMEOUT'].includes(e.code);
      if (!canFallback) {
        if (e instanceof zhipu.ProviderError) {
          throw new McpError(ErrorCode.InternalError, `[${e.code}] ${e.message}`, e.meta);
        }
        throw new McpError(ErrorCode.InternalError, `视觉分析失败: ${e && e.message ? e.message : '未知错误'}`);
      }
      fallbackReason = e.code;
      usedProvider = 'gemini';
      out = await tryGemini();
    }
  }

  // 4) 提取证据 + 组装返回
  const evidence = extractEvidence(out.content, rs.media_type);
  const warnings = [];
  if (fallbackReason) {
    warnings.push(
      `GLM 后端${fallbackReason === 'NO_API_KEY' ? '未配置 Key' : `失败（${fallbackReason}）`}，已自动回退 Gemini 完成本次分析。`
    );
  }
  if (rs.data_uri && rs.media_type !== 'image') {
    warnings.push(
      '本地视频/文件以 data URI 上传，智谱官方未承诺支持该形式；若分析失败请改用公网 URL。'
    );
  }
  if (responseFormat === 'json' && !/^\s*\{/.test(out.content.trim())) {
    warnings.push('模型未返回 JSON 格式（可能不支持 response_format=json），已按文本处理。');
  }
  if (evidence.length === 0 && rs.media_type === 'video') {
    warnings.push('模型回答中未检测到时间戳，视频结论可能缺少定位信息。');
  }

  const sourceInfo = {
    name: rs.name,
    local: rs.local,
    via_data_uri: rs.data_uri,
    size_bytes: rs.size,
  };

  const result = buildResult({
    model: usedProvider === 'gemini' ? config.geminiModel : config.model,
    mediaType: rs.media_type,
    answer: out.content,
    reasoning: out.reasoning,
    evidence,
    warnings,
    usage: out.usage,
    latencyMs: out.latencyMs,
    sourceInfo,
  });

  // 首次上传本地文件的隐私提示（不重复出现在每次返回，由调用方 Skill 负责提示；这里作为元数据标注）
  if (rs.local && config.privacyNoticeEnabled) {
    const label = usedProvider === 'gemini' ? 'Google Gemini' : '智谱 AI';
    result.privacy_notice = `该本地文件（${rs.name}，${rs.size || 0} 字节）将发送给 ${label}（${usedProvider === 'gemini' ? config.geminiModel : config.model}）进行视觉分析。`;
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    structuredContent: result,
  };
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [GLM_VISION_ANALYZE],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== 'glm_vision_analyze') {
    throw new McpError(ErrorCode.MethodNotFound, `未知工具: ${req.params.name}`);
  }
  try {
    return await handleAnalyze(req.params.arguments);
  } catch (e) {
    if (e instanceof McpError) {
      // 参数/权限/路径类错误：保留原始 message
      return {
        content: [{ type: 'text', text: `glm_vision_analyze 失败: ${e.message}` }],
        isError: true,
      };
    }
    return {
      content: [
        {
          type: 'text',
          text: `glm_vision_analyze 失败: ${e && e.message ? e.message : '未知错误'}`,
        },
      ],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // 不输出任何 stdout 日志（stdout 是 MCP 协议通道），诊断信息走 stderr
  process.stderr.write(`[glm-vision-mcp] started, model=${config.model}, api_key=${config.hasApiKey ? 'set' : 'NOT SET'}\n`);
}

main().catch((err) => {
  process.stderr.write(`[glm-vision-mcp] fatal: ${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});
