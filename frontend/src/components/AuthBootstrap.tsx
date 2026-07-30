import { useEffect, useState, type ReactNode } from "react";
import axios from "axios";
import { authStore } from "../stores/auth";
import BrandLogo from "./BrandLogo";

type Props = { children: ReactNode };

const REFRESH_TIMEOUT_MS = 8_000;

export default function AuthBootstrap({ children }: Props) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      if (authStore.getState().accessToken) {
        if (!cancelled) setReady(true);
        return;
      }

      try {
        const base = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api/v1";
        const response = await axios.post(
          `${base}/auth/refresh`,
          {},
          { withCredentials: true, timeout: REFRESH_TIMEOUT_MS }
        );
        authStore.getState().setAccessToken(response.data.access_token);
      } catch {
        // No valid refresh cookie or backend unavailable; user goes to login.
      }

      if (!cancelled) setReady(true);
    }

    void restoreSession();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return (
      <main className="login-screen">
        <section className="login-form-panel">
          <div className="login-card-v2 auth-bootstrap-card">
            <BrandLogo tone="dark" size="md" className="login-card-logo" />
            <p>جاري تحميل Watesly…</p>
          </div>
        </section>
      </main>
    );
  }

  return children;
}
