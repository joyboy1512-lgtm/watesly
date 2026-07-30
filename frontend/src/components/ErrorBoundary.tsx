import { Component, ErrorInfo, ReactNode } from "react";
import BrandLogo from "./BrandLogo";

type Props = { children: ReactNode };
type State = { failed: boolean };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("Watesly UI error", error, info); }

  render() {
    if (this.state.failed) {
      return (
        <main className="fatal-state">
          <div className="fatal-state-card">
            <BrandLogo tone="dark" size="lg" className="fatal-brand-logo" />
            <h1>تعذر عرض هذه الصفحة</h1>
            <p>تم الحفاظ على بياناتك. أعد تحميل الصفحة، وإذا تكرر الخطأ سجّل رقم الطلب الظاهر في أدوات المطور.</p>
            <button className="primary-action green" onClick={() => window.location.reload()}>إعادة التحميل</button>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}
