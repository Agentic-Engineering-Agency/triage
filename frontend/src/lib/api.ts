import { getConfig } from "./config"

/**
 * Base fetch wrapper for API calls.
 * All TanStack Query queryFn functions should use this.
 */
export async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const config = await getConfig()
  const url = `${config.apiUrl}${path}`

  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    credentials: "include", // Send auth cookies
  })

  const data = await response.json()

  if (!response.ok || data.success === false) {
    throw new Error(data.error?.message ?? "Request failed")
  }

  return data.data ?? data
}
