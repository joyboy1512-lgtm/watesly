import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";
import { authStore } from "../stores/auth";
import { toastStore } from "../stores/toast";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api/v1",
  timeout: 30000,
  withCredentials: true
});

let refreshPromise: Promise<string> | null = null;

type RetriableRequest = InternalAxiosRequestConfig & { _retry?: boolean };
type ValidationErrorItem = { msg?: string; loc?: (string | number)[] };

function parseResponseDetail(data: unknown): unknown {
  if (data == null) return undefined;
  if (typeof data === "object" && "detail" in data) {
    return (data as { detail?: unknown }).detail;
  }
  if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data) as { detail?: unknown };
      return parsed.detail ?? parsed;
    } catch {
      return data.trim() || undefined;
    }
  }
  if (data instanceof ArrayBuffer) {
    try {
      const text = new TextDecoder().decode(data).trim();
      if (!text) return undefined;
      const parsed = JSON.parse(text) as { detail?: unknown };
      return parsed.detail ?? parsed;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function formatApiError(error: unknown, fallback = "تعذر إكمال الطلب."): string {
  if (!axios.isAxiosError(error)) return fallback;
  const detail = parseResponseDetail(error.response?.data);
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "msg" in item) {
          const entry = item as ValidationErrorItem;
          const field = Array.isArray(entry.loc)
            ? entry.loc.filter((part) => part !== "body").join(".")
            : "";
          const msg = String(entry.msg ?? "");
          return field ? `${field}: ${msg}` : msg;
        }
        return null;
      })
      .filter((item): item is string => Boolean(item));
    if (messages.length) return messages.join(" · ");
  }
  if (detail && typeof detail === "object" && "code" in detail) {
    return String((detail as { code?: string }).code);
  }
  return fallback;
}

api.interceptors.request.use((config) => {
  const token = authStore.getState().accessToken;
  config.headers.set("X-Request-ID", crypto.randomUUID());
  if (token) config.headers.set("Authorization", `Bearer ${token}`);
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as RetriableRequest | undefined;
    if (error.response?.status !== 401 || original?._retry) {
      const status = error.response?.status;
      if (status && status !== 404) {
        const message = formatApiError(error);
        if (status === 429) {
          toastStore.getState().show("طلبات كثيرة. انتظر قليلًا ثم أعد المحاولة.", "error");
        } else if (status >= 400) {
          toastStore.getState().show(message, "error");
        }
      }
      if (!error.response) {
        const message =
          error.code === "ECONNABORTED"
            ? "انتهت مهلة الطلب. حاول مجددًا."
            : "تعذر الاتصال بالخادم. تحقق من تشغيل Watesly.";
        toastStore.getState().show(message, "error");
      }
      return Promise.reject(error);
    }

    if (!original) {
      authStore.getState().logout();
      return Promise.reject(error);
    }

    original._retry = true;
    try {
      if (!refreshPromise) {
        refreshPromise = axios
          .post(`${api.defaults.baseURL}/auth/refresh`, {}, { withCredentials: true })
          .then((response) => {
            authStore.getState().setAccessToken(response.data.access_token);
            return response.data.access_token as string;
          })
          .finally(() => { refreshPromise = null; });
      }
      const accessToken = await refreshPromise;
      original.headers.set("Authorization", `Bearer ${accessToken}`);
      return api(original);
    } catch (refreshError) {
      authStore.getState().logout();
      toastStore.getState().show("انتهت الجلسة. سجّل الدخول مجددًا.", "error");
      return Promise.reject(refreshError);
    }
  }
);
