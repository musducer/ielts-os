import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css' // Hoặc tên file css gốc của project

// 1. HỘP ĐEN (ERROR BOUNDARY) CHỐNG TRẮNG TRANG
class ErrorBoundary extends React.Component<any, any> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }
  componentDidCatch(error: any, errorInfo: any) {
    this.setState({ error, errorInfo });
    console.error("Lỗi gốc:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, background: '#fee', color: '#c00', fontFamily: 'monospace', height: '100vh', textAlign: 'left' }}>
          <h2>Đã bắt được lỗi gây trắng trang!</h2>
          <p><b>Nguyên nhân (Hãy chụp dòng này cho tôi):</b><br/>{this.state.error?.toString()}</p>
          <pre style={{ background: '#fff', padding: 20, border: '1px solid #c00', overflow: 'auto', maxHeight: '60vh', whiteSpace: 'pre-wrap', fontSize: 13 }}>
            {this.state.errorInfo?.componentStack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

// ==========================================
// TOAST TOÀN CỤC (thay window.alert)
// ==========================================
type ToastType = "info" | "success" | "error";
interface ToastItem { id: number; msg: string; type: ToastType; }
let _toastSeq = 0;

const classifyToast = (msg: string): ToastType => {
  const m = (msg || "").toLowerCase();
  if (/(lỗi|error|failed|fail|denied|network|không thể|thất bại|invalid|missing|thiếu|sai\b)/.test(m)) return "error";
  if (/(thành công|success|copied|đã \w|saved|synchron|đồng bộ|hoàn tất)/.test(m)) return "success";
  return "info";
};

const TOAST_STYLE: Record<ToastType, { accent: string }> = {
  info: { accent: "#4338ca" },
  success: { accent: "#16a34a" },
  error: { accent: "#dc2626" },
};

const ToastGlyph = ({ type }: { type: ToastType }) => {
  const props = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (type === "success") return <svg {...props}><path d="m5 12 4.2 4.2L19 6.5" /></svg>;
  if (type === "error") return <svg {...props}><path d="M12 8v5" /><path d="M12 17h.01" /><path d="M10.3 3.9 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>;
  return <svg {...props}><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" /></svg>;
};

function ToastHost() {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  React.useEffect(() => {
    const handler = (e: any) => {
      const id = ++_toastSeq;
      const msg = String(e.detail ?? "");
      setToasts((prev) => [...prev, { id, msg, type: classifyToast(msg) }].slice(-5));
      const dur = Math.min(8000, 2800 + msg.length * 35);
      setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), dur);
    };
    window.addEventListener("ielts-toast", handler as any);
    return () => window.removeEventListener("ielts-toast", handler as any);
  }, []);

  return (
    <div style={{ position: "fixed", top: 16, right: 16, zIndex: 2147483647, display: "flex", flexDirection: "column", gap: 10, maxWidth: 380, width: "calc(100vw - 32px)", pointerEvents: "none" }}>
      {toasts.map((t) => {
        const s = TOAST_STYLE[t.type];
        return (
          <div key={t.id} onClick={() => setToasts((p) => p.filter((x) => x.id !== t.id))}
            style={{ pointerEvents: "auto", cursor: "pointer", background: "rgba(255,255,255,0.96)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", borderRadius: 14, borderLeft: `5px solid ${s.accent}`, boxShadow: "0 12px 32px rgba(0,0,0,0.16)", padding: "13px 15px", display: "flex", gap: 11, alignItems: "flex-start", animation: "itoast-in 0.28s cubic-bezier(0.21,1.02,0.73,1)" }}>
            <span style={{ width: 18, height: 18, lineHeight: 1.2, flexShrink: 0, color: s.accent }}><ToastGlyph type={t.type} /></span>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: "#1e293b", lineHeight: 1.4, whiteSpace: "pre-line", wordBreak: "break-word" }}>{t.msg}</span>
          </div>
        );
      })}
    </div>
  );
}

// ==========================================
// CONFIRM MODAL TOÀN CỤC (promise-based) -> window.__ielts_confirm(msg)
// ==========================================
interface ConfirmState { open: boolean; msg: string; okText: string; cancelText: string; danger: boolean; resolve?: (v: boolean) => void; }

function ConfirmHost() {
  const [st, setSt] = React.useState<ConfirmState>({ open: false, msg: "", okText: "OK", cancelText: "Hủy", danger: false });
  React.useEffect(() => {
    (window as any).__ielts_confirm = (msg: string, opts?: { okText?: string; cancelText?: string; danger?: boolean }) =>
      new Promise<boolean>((resolve) => {
        setSt({ open: true, msg: String(msg ?? ""), okText: opts?.okText || "Đồng ý", cancelText: opts?.cancelText || "Hủy", danger: !!opts?.danger, resolve });
      });
    return () => { try { delete (window as any).__ielts_confirm; } catch {} };
  }, []);
  if (!st.open) return null;
  const close = (v: boolean) => { st.resolve?.(v); setSt((p) => ({ ...p, open: false })); };
  const accent = st.danger ? "#dc2626" : "#4338ca";
  return (
    <div onClick={() => close(false)} style={{ position: "fixed", inset: 0, zIndex: 2147483646, background: "rgba(15,23,42,0.55)", backdropFilter: "blur(4px)", display: "grid", placeItems: "center", padding: 20, animation: "iconfirm-fade 0.18s ease" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, boxShadow: "0 24px 60px rgba(0,0,0,0.3)", maxWidth: 420, width: "100%", padding: 26, animation: "iconfirm-pop 0.22s cubic-bezier(0.21,1.02,0.73,1)" }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#1e293b", lineHeight: 1.55, whiteSpace: "pre-line", marginBottom: 22 }}>{st.msg}</div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={() => close(false)} style={{ padding: "10px 18px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#f8fafc", color: "#475569", fontWeight: 700, fontSize: 13.5, cursor: "pointer" }}>{st.cancelText}</button>
          <button onClick={() => close(true)} style={{ padding: "10px 20px", borderRadius: 10, border: "none", background: accent, color: "#fff", fontWeight: 800, fontSize: 13.5, cursor: "pointer", boxShadow: `0 6px 16px ${accent}55` }}>{st.okText}</button>
        </div>
      </div>
    </div>
  );
}

// Inject keyframes 1 lần
(() => {
  if (document.getElementById("ielts-ui-kf")) return;
  const s = document.createElement("style");
  s.id = "ielts-ui-kf";
  s.textContent = "@keyframes itoast-in{from{opacity:0;transform:translateX(40px)}to{opacity:1;transform:none}}@keyframes iconfirm-fade{from{opacity:0}to{opacity:1}}@keyframes iconfirm-pop{from{opacity:0;transform:scale(0.92) translateY(10px)}to{opacity:1;transform:none}}";
  document.head.appendChild(s);
})();

// Override window.alert -> toast. Khi đang fullscreen (đang thi) thì giữ alert gốc để không bị che.
const _origAlert = window.alert.bind(window);
window.alert = (msg?: any) => {
  try {
    if (document.fullscreenElement) return _origAlert(msg);
    window.dispatchEvent(new CustomEvent("ielts-toast", { detail: String(msg ?? "") }));
  } catch { _origAlert(msg); }
};

// 2. RENDER
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
    <ToastHost />
    <ConfirmHost />
  </React.StrictMode>,
)

// PWA: đăng ký service worker để cài app & chạy ổn định khi mạng chập chờn
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((registration) => {
      if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            worker.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });
      void registration.update();
    }).catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}
