export type SiteBranding = {
  app_name: string;
  logo_dark_url: string;
  logo_light_url: string;
  icon_url: string;
  hero_image_url?: string;
  primary_color: string;
  accent_color: string;
};

export type SiteDisplay = {
  show_hero_mockup: boolean;
  show_features: boolean;
  show_how: boolean;
  show_api: boolean;
  show_cta: boolean;
  show_stats: boolean;
};

export type SiteLocaleContent = {
  landing: Record<string, string>;
  login: Record<string, string>;
  stats: Array<{ value: string; label: string }>;
  features: Array<{ icon: string; title: string; desc: string }>;
  steps: Array<{ title: string; desc: string }>;
  mockup: {
    title: string;
    pill: string;
    messages: Array<{ role: string; text: string }>;
    deal_card: { label: string; title: string; note: string };
  };
  api: {
    checklist: string[];
    code_sample: string;
  };
};

export type PublicSiteContent = {
  locale: string;
  branding: SiteBranding;
  display: SiteDisplay;
  landing: Record<string, string>;
  login: Record<string, string>;
  stats: SiteLocaleContent["stats"];
  features: SiteLocaleContent["features"];
  steps: SiteLocaleContent["steps"];
  mockup: SiteLocaleContent["mockup"];
  api: SiteLocaleContent["api"];
  published: boolean;
};

export type AdminSiteContent = {
  id: string;
  branding: SiteBranding;
  display: SiteDisplay;
  locales: Record<"ar" | "en", SiteLocaleContent>;
  is_published: boolean;
  published_at: string | null;
  updated_at: string;
};
