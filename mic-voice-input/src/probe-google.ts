/**
 * Reachability probe for the browser-owned speech service.
 *
 * Extracted from DeepSeek Harness (MIT) — packages/client/ui-conversation.
 *
 * Chrome's `SpeechRecognition` (and Electron's Chromium) routes audio to
 * Google's speech servers, which are unreachable on some networks (mainland
 * China being the common case). When recognition fails with a service-suspect
 * error, this probe asks whether the browser's current network path can reach
 * Google at all — an instant verdict on whether a proxy is actually in
 * effect, so the user knows to fix the proxy rather than the mic.
 *
 * Two hosts are probed separately because rule-based proxies commonly cover
 * `google.com` while leaving the speech infrastructure (`gstatic.com` and
 * friends) unproxied — google.com reachable with gstatic.com blocked is the
 * signature of a partial proxy rule set, and the caller says so explicitly.
 *
 * `no-cors` fetch resolves on ANY HTTP response (even errors) and rejects
 * only on network-level failure (DNS/TLS/connect), which is exactly the
 * reachability signal wanted.
 */

const PROBE_URLS: ReadonlyArray<readonly [host: 'google' | 'gstatic', url: string]> = [
  ['google', 'https://www.google.com/generate_204'],
  ['gstatic', 'https://www.gstatic.com/generate_204'],
]

/** Per-host reachability verdict. */
export interface GoogleProbeResult {
  readonly google: boolean
  readonly gstatic: boolean
}

/** Probe every host; each resolves true when reachable within the timeout. */
export async function probeGoogle(timeoutMs = 5000): Promise<GoogleProbeResult> {
  const result = { google: false, gstatic: false }
  await Promise.all(PROBE_URLS.map(async ([host, url]) => {
    try {
      const ok = await Promise.race([
        fetch(url, { mode: 'no-cors', cache: 'no-store' }).then(() => true),
        new Promise<boolean>(resolve => { setTimeout(() => resolve(false), timeoutMs) }),
      ])
      result[host] = ok
    } catch {
      // Network failure on this host — stays false.
    }
  }))
  return result
}
