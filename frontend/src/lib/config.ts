export interface AppConfig {
  apiUrl: string
  features?: {
    kanban?: boolean
    wiki?: boolean
  }
}

let cachedConfig: AppConfig | null = null

export async function getConfig(): Promise<AppConfig> {
  if (cachedConfig) return cachedConfig

  try {
    const response = await fetch("/config.json")
    if (response.ok) {
      cachedConfig = await response.json()
      return cachedConfig!
    }
  } catch {
    // Fallback for local dev
  }

  cachedConfig = {
    apiUrl: "/api",
  }
  return cachedConfig
}
