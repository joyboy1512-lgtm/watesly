import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, formatApiError } from "../lib/api";
import { createDefaultAdminSiteContent } from "../lib/siteContentDefaults";
import { toastStore } from "../stores/toast";
import type { AdminSiteContent, SiteLocaleContent } from "../types/siteContent";

type Tab = "branding" | "hero" | "features" | "sections" | "display";

const LANDING_FIELDS: Array<{ key: string; label: string; multiline?: boolean }> = [
  { key: "heroEyebrow", label: "Eyebrow — Hero" },
  { key: "heroTitle", label: "العنوان الرئيسي" },
  { key: "heroTitleAccent", label: "جزء العنوان المميز" },
  { key: "heroLead", label: "الفقرة التمهيدية", multiline: true },
  { key: "tryPlatform", label: "زر — جرّب المنصة" },
  { key: "exploreFeatures", label: "زر — استكشف الميزات" },
  { key: "featuresEyebrow", label: "Eyebrow — الميزات" },
  { key: "featuresTitle", label: "عنوان الميزات" },
  { key: "featuresSubtitle", label: "وصف الميزات", multiline: true },
  { key: "howEyebrow", label: "Eyebrow — كيف يعمل" },
  { key: "howTitle", label: "عنوان — كيف يعمل" },
  { key: "apiEyebrow", label: "Eyebrow — API" },
  { key: "apiTitle", label: "عنوان API" },
  { key: "apiBody", label: "نص API", multiline: true },
  { key: "apiDemo", label: "زر API demo" },
  { key: "ctaTitle", label: "عنوان CTA" },
  { key: "ctaBody", label: "نص CTA", multiline: true },
  { key: "enterPlatform", label: "زر دخول المنصة" },
  { key: "footerTagline", label: "Footer tagline" },
  { key: "footerRights", label: "Footer rights (استخدم {{year}})" },
];

const LOGIN_FIELDS: Array<{ key: string; label: string; multiline?: boolean }> = [
  { key: "heroTitle", label: "عنوان لوحة تسجيل الدخول" },
  { key: "heroBody", label: "الفقرة", multiline: true },
  { key: "trustCatalog", label: "نقطة ثقة 1" },
  { key: "trustAi", label: "نقطة ثقة 2" },
  { key: "trustInbox", label: "نقطة ثقة 3" },
];

async function uploadSiteAsset(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const response = await api.post<{ url: string }>("/admin/site-content/assets", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data.url;
}

export default function SiteContentPage() {
  const client = useQueryClient();
  const [tab, setTab] = useState<Tab>("branding");
  const [locale, setLocale] = useState<"ar" | "en">("ar");
  const [draft, setDraft] = useState<AdminSiteContent>(() => createDefaultAdminSiteContent());
  const [uploading, setUploading] = useState<string | null>(null);

  const config = useQuery({
    queryKey: ["admin-site-content"],
    queryFn: async () => (await api.get<AdminSiteContent>("/admin/site-content")).data,
    retry: 1,
  });

  useEffect(() => {
    if (config.data) setDraft(config.data);
  }, [config.data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!draft) return;
      await api.put("/admin/site-content", {
        branding: draft.branding,
        display: draft.display,
        locales: draft.locales,
        is_published: draft.is_published,
      });
    },
    onSuccess: async () => {
      toastStore.getState().show("تم حفظ ونشر محتوى الموقع.", "success");
      await client.invalidateQueries({ queryKey: ["admin-site-content"] });
      await client.invalidateQueries({ queryKey: ["site-content"] });
    },
    onError: (error) => {
      toastStore.getState().show(formatApiError(error, "تعذر حفظ المحتوى."), "error");
    },
  });

  const localeContent = useMemo(
    () => draft.locales[locale] ?? draft.locales.ar,
    [draft, locale],
  );

  function updateLandingField(key: string, value: string) {
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        locales: {
          ...current.locales,
          [locale]: {
            ...current.locales[locale],
            landing: { ...current.locales[locale].landing, [key]: value },
          },
        },
      };
    });
  }

  function updateLoginField(key: string, value: string) {
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        locales: {
          ...current.locales,
          [locale]: {
            ...current.locales[locale],
            login: { ...current.locales[locale].login, [key]: value },
          },
        },
      };
    });
  }

  function updateBranding(key: keyof AdminSiteContent["branding"], value: string) {
    setDraft((current) => {
      if (!current) return current;
      return { ...current, branding: { ...current.branding, [key]: value } };
    });
  }

  function updateDisplay(key: keyof AdminSiteContent["display"], value: boolean) {
    setDraft((current) => {
      if (!current) return current;
      return { ...current, display: { ...current.display, [key]: value } };
    });
  }

  function updateLocaleBlock<K extends keyof SiteLocaleContent>(
    block: K,
    value: SiteLocaleContent[K],
  ) {
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        locales: {
          ...current.locales,
          [locale]: { ...current.locales[locale], [block]: value },
        },
      };
    });
  }

  async function handleAssetUpload(
    field: "logo_dark_url" | "logo_light_url" | "icon_url" | "hero_image_url",
    file: File | undefined,
  ) {
    if (!file) return;
    setUploading(field);
    try {
      const url = await uploadSiteAsset(file);
      updateBranding(field, url);
      toastStore.getState().show("تم رفع الصورة.", "success");
    } catch {
      toastStore.getState().show("تعذر رفع الصورة.", "error");
    } finally {
      setUploading(null);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  if (config.isLoading && !config.data) {
    return (
      <main className="page site-content-page">
        <header className="page-header">
          <h1>محتوى الموقع</h1>
          <p>جاري التحميل…</p>
        </header>
      </main>
    );
  }

  const loadError = config.isError
    ? formatApiError(config.error, "تعذر تحميل إعدادات الموقع من الخادم.")
    : null;

  return (
    <main className="page site-content-page">
      {loadError && (
        <section className="card site-content-error">
          <strong>تعذر المزامنة مع الخادم</strong>
          <p>{loadError}</p>
          <p className="hint-text">
            تأكد من تشغيل الـ backend (أعد تشغيله بعد التحديث) — migration تم: <code dir="ltr">0030</code>.
            {" "}سجّل الدخول بحساب Super Admin مثل <code dir="ltr">admin@example.com</code>.
          </p>
          <button type="button" className="secondary-button" onClick={() => void config.refetch()}>
            إعادة المحاولة
          </button>
        </section>
      )}
      <header className="page-header catalog-hero">
        <div>
          <span className="eyebrow">CMS</span>
          <h1>محتوى الموقع والعرض</h1>
          <p>تحكم في الشعار، الصور، الفقرات، وأقسام الصفحة التعريفية وتسجيل الدخول.</p>
        </div>
        <div className="site-content-header-actions">
          <Link to="/" target="_blank" className="secondary-button">معاينة الموقع ↗</Link>
          <button type="button" className="whatsapp-button" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "جاري الحفظ…" : "حفظ ونشر"}
          </button>
        </div>
      </header>

      <div className="site-content-toolbar card">
        <div className="site-content-tabs">
          {([
            ["branding", "الهوية والصور"],
            ["hero", "Hero والنصوص"],
            ["features", "الميزات والخطوات"],
            ["sections", "Mockup و API"],
            ["display", "إظهار/إخفاء"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`site-content-tab ${tab === id ? "active" : ""}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="site-content-locale">
          <span>اللغة</span>
          <select value={locale} onChange={(e) => setLocale(e.target.value as "ar" | "en")}>
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </select>
        </label>
      </div>

      <form className="site-content-form" onSubmit={handleSubmit}>
        {tab === "branding" && (
          <section className="card site-content-panel">
            <h2 className="section-title-sm">الهوية البصرية</h2>
            <div className="site-content-grid">
              <label className="field-label">
                <span>اسم المنصة</span>
                <input value={draft.branding.app_name} onChange={(e) => updateBranding("app_name", e.target.value)} />
              </label>
              <label className="field-label">
                <span>اللون الأساسي</span>
                <input type="color" value={draft.branding.primary_color} onChange={(e) => updateBranding("primary_color", e.target.value)} />
              </label>
              <label className="field-label">
                <span>لون التميز</span>
                <input type="color" value={draft.branding.accent_color} onChange={(e) => updateBranding("accent_color", e.target.value)} />
              </label>
            </div>
            <div className="site-content-assets">
              {([
                ["logo_dark_url", "شعار — خلفية فاتحة", draft.branding.logo_dark_url],
                ["logo_light_url", "شعار — خلفية داكنة/خضراء", draft.branding.logo_light_url],
                ["icon_url", "أيقونة الموقع", draft.branding.icon_url],
                ["hero_image_url", "صورة Hero (اختياري)", draft.branding.hero_image_url ?? ""],
              ] as const).map(([field, label, preview]) => (
                <article key={field} className="site-content-asset">
                  <strong>{label}</strong>
                  {preview ? <img src={preview} alt={label} className="site-content-preview" /> : <p className="hint-text">لا توجد صورة</p>}
                  <input
                    dir="ltr"
                    value={preview}
                    onChange={(e) => updateBranding(field, e.target.value)}
                    placeholder="https://..."
                  />
                  <label className="secondary-button compact upload-button">
                    {uploading === field ? "…" : "رفع صورة"}
                    <input
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(e) => void handleAssetUpload(field, e.target.files?.[0])}
                    />
                  </label>
                </article>
              ))}
            </div>
          </section>
        )}

        {tab === "hero" && (
          <section className="card site-content-panel">
            <h2 className="section-title-sm">Hero — الصفحة التعريفية</h2>
            <div className="site-content-fields">
              {LANDING_FIELDS.map((field) => (
                <label key={field.key} className="field-label">
                  <span>{field.label}</span>
                  {field.multiline ? (
                    <textarea
                      rows={3}
                      value={localeContent.landing[field.key] ?? ""}
                      onChange={(e) => updateLandingField(field.key, e.target.value)}
                    />
                  ) : (
                    <input
                      value={localeContent.landing[field.key] ?? ""}
                      onChange={(e) => updateLandingField(field.key, e.target.value)}
                    />
                  )}
                </label>
              ))}
            </div>
            <h3 className="section-title-sm">تسجيل الدخول — اللوحة الخضراء</h3>
            <div className="site-content-fields">
              {LOGIN_FIELDS.map((field) => (
                <label key={field.key} className="field-label">
                  <span>{field.label}</span>
                  {field.multiline ? (
                    <textarea
                      rows={3}
                      value={localeContent.login[field.key] ?? ""}
                      onChange={(e) => updateLoginField(field.key, e.target.value)}
                    />
                  ) : (
                    <input
                      value={localeContent.login[field.key] ?? ""}
                      onChange={(e) => updateLoginField(field.key, e.target.value)}
                    />
                  )}
                </label>
              ))}
            </div>
          </section>
        )}

        {tab === "features" && (
          <section className="card site-content-panel">
            <h2 className="section-title-sm">الميزات</h2>
            <div className="site-content-repeat">
              {localeContent.features.map((item, index) => (
                <article key={index} className="site-content-repeat-item">
                  <label className="field-label">
                    <span>أيقونة</span>
                    <input
                      value={item.icon}
                      onChange={(e) => {
                        const next = [...localeContent.features];
                        next[index] = { ...item, icon: e.target.value };
                        updateLocaleBlock("features", next);
                      }}
                    />
                  </label>
                  <label className="field-label">
                    <span>العنوان</span>
                    <input
                      value={item.title}
                      onChange={(e) => {
                        const next = [...localeContent.features];
                        next[index] = { ...item, title: e.target.value };
                        updateLocaleBlock("features", next);
                      }}
                    />
                  </label>
                  <label className="field-label">
                    <span>الوصف</span>
                    <textarea
                      rows={2}
                      value={item.desc}
                      onChange={(e) => {
                        const next = [...localeContent.features];
                        next[index] = { ...item, desc: e.target.value };
                        updateLocaleBlock("features", next);
                      }}
                    />
                  </label>
                </article>
              ))}
            </div>
            <h2 className="section-title-sm">الخطوات</h2>
            <div className="site-content-repeat">
              {localeContent.steps.map((item, index) => (
                <article key={index} className="site-content-repeat-item">
                  <label className="field-label">
                    <span>العنوان</span>
                    <input
                      value={item.title}
                      onChange={(e) => {
                        const next = [...localeContent.steps];
                        next[index] = { ...item, title: e.target.value };
                        updateLocaleBlock("steps", next);
                      }}
                    />
                  </label>
                  <label className="field-label">
                    <span>الوصف</span>
                    <textarea
                      rows={2}
                      value={item.desc}
                      onChange={(e) => {
                        const next = [...localeContent.steps];
                        next[index] = { ...item, desc: e.target.value };
                        updateLocaleBlock("steps", next);
                      }}
                    />
                  </label>
                </article>
              ))}
            </div>
            <h2 className="section-title-sm">إحصائيات Hero</h2>
            <div className="site-content-repeat">
              {localeContent.stats.map((item, index) => (
                <article key={index} className="site-content-repeat-item inline-pair">
                  <label className="field-label">
                    <span>القيمة</span>
                    <input
                      value={item.value}
                      onChange={(e) => {
                        const next = [...localeContent.stats];
                        next[index] = { ...item, value: e.target.value };
                        updateLocaleBlock("stats", next);
                      }}
                    />
                  </label>
                  <label className="field-label">
                    <span>التسمية</span>
                    <input
                      value={item.label}
                      onChange={(e) => {
                        const next = [...localeContent.stats];
                        next[index] = { ...item, label: e.target.value };
                        updateLocaleBlock("stats", next);
                      }}
                    />
                  </label>
                </article>
              ))}
            </div>
          </section>
        )}

        {tab === "sections" && (
          <section className="card site-content-panel">
            <h2 className="section-title-sm">Mockup Inbox</h2>
            <div className="site-content-grid">
              <label className="field-label">
                <span>العنوان</span>
                <input
                  value={localeContent.mockup.title}
                  onChange={(e) => updateLocaleBlock("mockup", { ...localeContent.mockup, title: e.target.value })}
                />
              </label>
              <label className="field-label">
                <span>Pill</span>
                <input
                  value={localeContent.mockup.pill}
                  onChange={(e) => updateLocaleBlock("mockup", { ...localeContent.mockup, pill: e.target.value })}
                />
              </label>
            </div>
            <div className="site-content-repeat">
              {localeContent.mockup.messages.map((msg, index) => (
                <label key={index} className="field-label">
                  <span>رسالة {index + 1} ({msg.role})</span>
                  <input
                    value={msg.text}
                    onChange={(e) => {
                      const messages = [...localeContent.mockup.messages];
                      messages[index] = { ...msg, text: e.target.value };
                      updateLocaleBlock("mockup", { ...localeContent.mockup, messages });
                    }}
                  />
                </label>
              ))}
            </div>
            <h3 className="section-title-sm">بطاقة CRM</h3>
            <div className="site-content-grid">
              {(["label", "title", "note"] as const).map((key) => (
                <label key={key} className="field-label">
                  <span>{key}</span>
                  <input
                    value={localeContent.mockup.deal_card[key]}
                    onChange={(e) =>
                      updateLocaleBlock("mockup", {
                        ...localeContent.mockup,
                        deal_card: { ...localeContent.mockup.deal_card, [key]: e.target.value },
                      })
                    }
                  />
                </label>
              ))}
            </div>
            <h2 className="section-title-sm">قسم API</h2>
            <label className="field-label">
              <span>Checklist (سطر لكل نقطة)</span>
              <textarea
                rows={5}
                value={localeContent.api.checklist.join("\n")}
                onChange={(e) =>
                  updateLocaleBlock("api", {
                    ...localeContent.api,
                    checklist: e.target.value.split("\n").filter(Boolean),
                  })
                }
              />
            </label>
            <label className="field-label">
              <span>Code sample</span>
              <textarea
                rows={6}
                dir="ltr"
                value={localeContent.api.code_sample}
                onChange={(e) => updateLocaleBlock("api", { ...localeContent.api, code_sample: e.target.value })}
              />
            </label>
          </section>
        )}

        {tab === "display" && (
          <section className="card site-content-panel">
            <h2 className="section-title-sm">إظهار الأقسام</h2>
            <div className="site-content-toggles">
              {([
                ["show_stats", "إحصائيات Hero"],
                ["show_hero_mockup", "Mockup Inbox"],
                ["show_features", "قسم الميزات"],
                ["show_how", "كيف يعمل"],
                ["show_api", "قسم API"],
                ["show_cta", "CTA السفلي"],
              ] as const).map(([key, label]) => (
                <label key={key} className="inline-checkbox">
                  <input
                    type="checkbox"
                    checked={draft.display[key]}
                    onChange={(e) => updateDisplay(key, e.target.checked)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <label className="inline-checkbox publish-toggle">
              <input
                type="checkbox"
                checked={draft.is_published}
                onChange={(e) => setDraft({ ...draft, is_published: e.target.checked })}
              />
              <span>منشور — يظهر للزوار على الموقع العام</span>
            </label>
          </section>
        )}

        <div className="site-content-footer-actions">
          <button type="submit" className="whatsapp-button" disabled={save.isPending}>
            {save.isPending ? "جاري الحفظ…" : "حفظ ونشر التغييرات"}
          </button>
        </div>
      </form>
    </main>
  );
}
