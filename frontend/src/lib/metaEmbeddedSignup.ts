export type EmbeddedSignupConfig = {
  enabled: boolean;
  app_id: string | null;
  config_id: string | null;
  api_version: string;
};

export type EmbeddedSignupSession = {
  waba_id: string;
  phone_number_id: string;
  business_id?: string;
};

type FacebookLoginResponse = {
  authResponse?: { code?: string };
  status?: string;
};

declare global {
  interface Window {
    FB?: {
      init: (params: Record<string, unknown>) => void;
      login: (callback: (response: FacebookLoginResponse) => void, options: Record<string, unknown>) => void;
    };
    fbAsyncInit?: () => void;
  }
}

let sdkPromise: Promise<void> | null = null;

export function loadFacebookSdk(appId: string, apiVersion: string): Promise<void> {
  if (window.FB) return Promise.resolve();
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB?.init({
        appId,
        autoLogAppEvents: true,
        xfbml: true,
        version: apiVersion
      });
      resolve();
    };

    const existing = document.getElementById("facebook-jssdk");
    if (existing) {
      existing.addEventListener("load", () => resolve());
      return;
    }

    const script = document.createElement("script");
    script.id = "facebook-jssdk";
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.onerror = () => reject(new Error("Failed to load Facebook SDK"));
    document.body.appendChild(script);
  });

  return sdkPromise;
}

export function listenEmbeddedSignup(
  onSession: (session: EmbeddedSignupSession) => void
): () => void {
  function handler(event: MessageEvent) {
    if (event.origin !== "https://www.facebook.com" && event.origin !== "https://web.facebook.com") {
      return;
    }
    try {
      const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      if (data?.type === "WA_EMBEDDED_SIGNUP" && data?.data) {
        const payload = data.data as Record<string, string>;
        if (payload.phone_number_id && payload.waba_id) {
          onSession({
            waba_id: payload.waba_id,
            phone_number_id: payload.phone_number_id,
            business_id: payload.business_id
          });
        }
      }
    } catch {
      /* ignore non-json */
    }
  }
  window.addEventListener("message", handler);
  return () => window.removeEventListener("message", handler);
}

export function launchEmbeddedSignup(configId: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    if (!window.FB) {
      reject(new Error("Facebook SDK not loaded"));
      return;
    }
    window.FB.login(
      (response) => {
        if (response.authResponse?.code) {
          resolve(response.authResponse.code);
          return;
        }
        resolve(null);
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          sessionInfoVersion: 3
        }
      }
    );
  });
}

export const QUALITY_LABELS: Record<string, string> = {
  GREEN: "ممتاز",
  YELLOW: "متوسط",
  RED: "منخفض",
  UNKNOWN: "غير معروف"
};

export function qualityClass(rating: string | null | undefined): string {
  const key = (rating ?? "UNKNOWN").toUpperCase();
  if (key === "GREEN") return "quality-green";
  if (key === "YELLOW") return "quality-yellow";
  if (key === "RED") return "quality-red";
  return "quality-unknown";
}
