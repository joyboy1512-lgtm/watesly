import { useEffect, useState } from "react";
import { BRAND_LOGO_PATHS, resolveBrandAssetUrl } from "../lib/brandAssets";

type BrandLogoProps = {
  /** dark = dark text for light backgrounds, light = white text for green/dark backgrounds, icon = mark only */
  tone?: "dark" | "light" | "icon";
  size?: "sm" | "md" | "lg" | "hero";
  className?: string;
  src?: string;
  alt?: string;
};

const LOGOS = BRAND_LOGO_PATHS;

export default function BrandLogo({
  tone = "dark",
  size = "md",
  className = "",
  src,
  alt = "Watesly",
}: BrandLogoProps) {
  const layout = tone === "icon" ? "brand-logo-icon" : "brand-logo-horizontal";
  const fallback = LOGOS[tone];
  const resolved = resolveBrandAssetUrl(src, fallback);
  const [currentSrc, setCurrentSrc] = useState(resolved);

  useEffect(() => {
    setCurrentSrc(resolveBrandAssetUrl(src, fallback));
  }, [src, fallback]);

  return (
    <img
      src={currentSrc}
      alt={alt}
      className={`brand-logo ${layout} brand-logo-${size} brand-logo-tone-${tone} ${className}`.trim()}
      decoding="async"
      onError={() => {
        if (currentSrc !== fallback) setCurrentSrc(fallback);
      }}
    />
  );
}
