/**
 * Verify apiproxy's gate input: resolveModelInfo for the CURRENT default model
 * and the fallback models must now report inputModalities including 'image',
 * so dsh-host-apiproxy prompt() admits image messages (the vision router
 * plugin then switches the step to glm/glm-4v).
 * Run with cwd = F:\DSH Desktop\resources\app
 */
import { boot, loadProfile } from '@deepseek-ai/dsh-app-boot'
import { join } from 'node:path'

const home = join(process.env['USERPROFILE'], 'AppData', 'Roaming', 'dsh-desktop', 'harness')
const installAnchor = join(process.cwd(), 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
const profile = loadProfile('e2e', 'web', installAnchor, home)
const baseLayer = profile.layers.find((l) => l.packageName === '@deepseek-ai/dsh-base')
const allPatches = [...(baseLayer?.patches ?? []), ...profile.patches]

const ctx = await boot('e2e', join(profile.dir, 'cordis.yml'), allPatches)
let failures = 0
const check = (name, cond, extra) => {
  if (cond) console.log(`  ok: ${name}`)
  else { failures += 1; console.error(`FAIL: ${name}`, extra ?? '') }
}

const llm = ctx.get('llm')
const probes = [
  ['omni', 'opencode-go/deepseek-v4-flash-max'],
  ['opencode-go', 'deepseek-v4-flash'],
  ['omni', 'omni-default'],
  ['omni', 'FREE DEEPSEEK V4 FLASH'],
  ['glm', 'glm-4v'],
]
for (const [provider, model] of probes) {
  try {
    const info = await llm.resolveModelInfo(provider, model)
    const mods = info?.inputModalities ?? []
    check(`${provider}/${model} input includes image`, mods.includes('image'), mods)
  } catch (e) {
    check(`${provider}/${model} input includes image`, false, String(e?.message ?? e))
  }
}
console.log(failures === 0 ? '\nAPIPROXY GATE VERIFIED' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
