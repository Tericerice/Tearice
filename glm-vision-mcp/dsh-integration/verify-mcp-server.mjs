/**
 * verify-mcp-server.mjs — 直接验证 glm-vision-mcp server 可用性
 *
 * 用极简 JSON-RPC over stdio 客户端（零依赖，新行分隔）与 server.js 握手：
 *  1. initialize + initialized
 *  2. tools/list → 期望列出 glm_vision_analyze
 *  3. tools/call → 用 samples/ocr-sample.png 真实调用一次视觉分析
 *
 * 用法：
 *   node verify-mcp-server.mjs
 * 环境变量：
 *   GLM_MCP_SERVER  server.js 路径（默认 D:\GitHub Program\glm-vision-mcp\server.js）
 *   GLM_MCP_SAMPLE  测试图片路径（默认 samples\ocr-sample.png）
 */
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const SERVER = process.env.GLM_MCP_SERVER ?? 'D:/GitHub Program/glm-vision-mcp/server.js'
const SAMPLE = process.env.GLM_MCP_SAMPLE ?? 'D:/GitHub Program/glm-vision-mcp/samples/ocr-sample.png'

let failures = 0
const check = (name, cond, extra) => {
  if (cond) console.log(`  ok: ${name}`)
  else { failures += 1; console.error(`FAIL: ${name}`, extra ?? '') }
}

const child = spawn(process.execPath, [SERVER], {
  cwd: 'D:/GitHub Program/glm-vision-mcp',
  stdio: ['pipe', 'pipe', 'pipe'],
})

const rl = createInterface({ input: child.stdout })
const pending = new Map()
let nextId = 1

child.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`))

function request(method, params) {
  return new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
}
function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
}

rl.on('line', (line) => {
  let msg
  try { msg = JSON.parse(line) } catch { return }
  if (msg.id !== undefined && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) reject(new Error(`${msg.error.code}: ${msg.error.message}`))
    else resolve(msg.result)
  }
})

const timeout = (ms, label) => new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} 超时`)), ms))

try {
  console.log('test 1: initialize handshake')
  const init = await Promise.race([
    request('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'dsh-verify', version: '0.0.1' },
    }),
    timeout(15000, 'initialize'),
  ])
  check('server info returned', Boolean(init?.serverInfo), init)
  check('serverName = glm-vision-mcp', init?.serverInfo?.name === 'glm-vision-mcp', init?.serverInfo)
  notify('notifications/initialized', {})

  console.log('test 2: tools/list')
  const list = await Promise.race([request('tools/list', {}), timeout(15000, 'tools/list')])
  const tools = list?.tools ?? []
  check('glm_vision_analyze listed', tools.some((t) => t.name === 'glm_vision_analyze'), tools.map((t) => t.name))
  const tool = tools.find((t) => t.name === 'glm_vision_analyze')
  check('inputSchema declares source/prompt required', Boolean(
    tool?.inputSchema?.required?.includes('source') && tool?.inputSchema?.required?.includes('prompt'),
  ), tool?.inputSchema?.required)

  console.log('test 3: tools/call on ocr sample')
  const started = Date.now()
  const called = await Promise.race([
    request('tools/call', {
      name: 'glm_vision_analyze',
      arguments: {
        source: SAMPLE,
        media_type: 'image',
        prompt: '识别这张图片里的所有文字，逐条给出，并给出区域坐标',
      },
    }),
    timeout(90000, 'tools/call'),
  ])
  const elapsed = ((Date.now() - started) / 1000).toFixed(1)
  console.log(`  (call took ${elapsed}s)`)

  const text = Array.isArray(called?.content) ? called.content.map((c) => c.text ?? '').join('\n') : ''
  const parsed = (() => { try { return JSON.parse(text) } catch { return null } })()
  if (parsed) {
    check('structured result has answer', typeof parsed.answer === 'string' && parsed.answer.length > 0)
    check('result mentions model', typeof parsed.model === 'string' && parsed.model.length > 0, parsed.model)
    check('confidence present', ['high', 'medium', 'low'].includes(parsed.confidence), parsed.confidence)
    console.log('  answer:', String(parsed.answer).slice(0, 300))
  } else {
    check('call returned text content', text.length > 0, text.slice(0, 400))
  }
  check('call not flagged isError', called?.isError !== true, called?.isError)
} catch (e) {
  failures += 1
  console.error(`FAIL: ${e.message}`)
} finally {
  child.kill()
}

console.log(failures === 0 ? '\nMCP SERVER VERIFY ALL PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
