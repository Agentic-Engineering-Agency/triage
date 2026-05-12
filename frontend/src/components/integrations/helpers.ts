import type { TestResponse } from "./types"

export function reasonToMessage(
  res: Extract<TestResponse, { valid: false }>,
  providerName: string,
): string {
  if (res.reason === "invalid_key")
    return `Key rejected by ${providerName} (401).`
  if (res.reason === "network")
    return `Couldn't reach ${providerName}${res.message ? ` — ${res.message}` : ""}.`
  if (res.reason === "not_implemented")
    return "Test connection isn't implemented for this provider yet."
  return "Test failed."
}

export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  const diff = Date.now() - then
  const min = Math.round(diff / 60_000)
  if (min < 1) return "just now"
  if (min < 60) return `${min} min ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr} hr ago`
  const d = Math.round(hr / 24)
  return `${d} d ago`
}
