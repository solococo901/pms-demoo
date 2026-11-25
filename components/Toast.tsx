"use client";
// TOAST4 — components/Toast.tsx (Thong bao dung chung, co Hoan tac)
// Bat ky trang/component nao goi useToast().showToast(...) de hien
// thong bao co dinh o goc phai duoi man hinh khi thao tac xong.
// Tu tat sau 4 giay (10 giay neu co nut Hoan tac), bam de tat som.
// showToast("...", "success", () => { ... }) them nut Hoan tac.

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

export type ToastKind = "success" | "error" | "info";
type ToastItem = { id: number; message: string; kind: ToastKind; onUndo?: () => void };

type ToastApi = {
  showToast: (message: string, kind?: ToastKind, onUndo?: () => void) => void;
  success: (message: string, onUndo?: () => void) => void;
  error: (message: string, onUndo?: () => void) => void;
  info: (message: string, onUndo?: () => void) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast phai dung ben trong <ToastProvider>.");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, kind: ToastKind = "success", onUndo?: () => void) => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev.slice(-2), { id, message, kind, onUndo }]);
    // Co nut Hoan tac thi de lau hon (10 giay) de kip bam.
    window.setTimeout(() => dismiss(id), onUndo ? 10000 : 4000);
  }, [dismiss]);

  const api = useMemo<ToastApi>(() => ({
    showToast,
    success: (message: string, onUndo?: () => void) => showToast(message, "success", onUndo),
    error: (message: string, onUndo?: () => void) => showToast(message, "error", onUndo),
    info: (message: string, onUndo?: () => void) => showToast(message, "info", onUndo),
  }), [showToast]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[80] flex w-[min(92vw,380px)] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex w-full items-start gap-2 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-card ${
              t.kind === "success" ? "bg-success" : t.kind === "error" ? "bg-danger" : "bg-ink"
            }`}
          >
            <button onClick={() => dismiss(t.id)} className="flex-1 text-left" title="Bấm để tắt thông báo">
              {t.message}
            </button>
            {t.onUndo && (
              <button
                onClick={() => { const u = t.onUndo; dismiss(t.id); if (u) u(); }}
                className="shrink-0 rounded-lg bg-white px-2.5 py-1 font-bold text-ink"
              >
                Hoàn tác
              </button>
            )}
            <button onClick={() => dismiss(t.id)} className="shrink-0 font-bold opacity-70" title="Tắt thông báo" aria-label="Tắt thông báo">
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
