/**
 * Smoke test: boot the REAL web profile (its cordis.yml + cordis.patch.yml)
 * with the plugin and confirm the Loader activates vision-auto-router.
 *
 * This uses the real profile dir as the boot config dir, so relative entry
 * names (./vision-auto-router.mjs) resolve exactly as in the real `dsh web`.
 */
import { boot, loadOptionalPatches } from '@deepseek-ai/dsh-app-boot'
import { join } from 'node:path'

const profileDir = join(process.env['USERPROFILE'], '.dsh', 'profiles', 'web')
const configPath = join(profileDir, 'cordis.yml')
const patchPath = join(profileDir, 'cordis.patch.yml')
const patches = loadOptionalPatches('smoke', patchPath)
console.log('patches parsed:', patches.length, 'layer(s)')

const ctx = await boot('smoke', configPath, patches)
const entries = [...ctx.loader.entries()]
const router = entries.find((e) => e.options.id === 'vision-auto-router')
console.log('router entry found:', Boolean(router))
console.log('router fiber active:', Boolean(router?.fiber))
console.log('router config:', JSON.stringify(router?.options?.config))
await ctx.fiber.dispose()
console.log('BOOT SMOKE OK')
