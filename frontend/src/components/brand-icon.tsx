/**
 * BrandIcon — themed brand logos sourced from svgl.app.
 *
 * SVGs are downloaded once into `/public/brands/` so the app stays free of
 * runtime CDN dependencies. Logos that look different on light vs dark
 * backgrounds ship as two variants (`<name>-light.svg` + `<name>-dark.svg`)
 * and the active theme picks the right one via `resolvedTheme`. Mono-tone
 * logos (Linear, Slack) ship as a single file.
 *
 * lucide-react dropped brand icons on trademark grounds; svgl is the
 * upstream source that the brand owners themselves point to, which makes
 * it the right place to pull from for a few stable logos.
 */
import { useTheme } from "@/components/theme-provider"

type Brand = "github" | "linear" | "slack" | "resend" | "openrouter"

// Brands that ship a single mono-tone SVG (no theme swap).
const SINGLE_VARIANT: Record<Brand, boolean> = {
  github: false,
  linear: true,
  slack: true,
  resend: false,
  openrouter: false,
}

const BRAND_LABEL: Record<Brand, string> = {
  github: "GitHub",
  linear: "Linear",
  slack: "Slack",
  resend: "Resend",
  openrouter: "OpenRouter",
}

export function BrandIcon({
  name,
  className,
}: {
  name: Brand
  className?: string
}) {
  const { resolvedTheme } = useTheme()
  const src = SINGLE_VARIANT[name]
    ? `/brands/${name}.svg`
    : `/brands/${name}-${resolvedTheme}.svg`
  return (
    <img
      src={src}
      alt={`${BRAND_LABEL[name]} logo`}
      className={className}
      draggable={false}
    />
  )
}
