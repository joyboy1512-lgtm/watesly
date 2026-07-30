export const BRAND_LOGO_PATHS = {
  dark: "/brand/watesly-logo-dark.png",
  light: "/brand/watesly-logo-light.png",
  icon: "/brand/watesly-icon.png",
} as const;

/** Use CMS/storage URLs when valid; fall back to bundled brand assets. */
export function resolveBrandAssetUrl(url: string | undefined | null, fallback: string): string {
  const trimmed = url?.trim() ?? "";
  if (!trimmed) return fallback;
  if (trimmed.startsWith("/brand/")) return trimmed;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  if (trimmed.startsWith("data:")) return trimmed;
  // Reject broken relative paths saved in CMS (e.g. /x.png).
  if (trimmed.startsWith("/")) return fallback;
  return trimmed;
}
