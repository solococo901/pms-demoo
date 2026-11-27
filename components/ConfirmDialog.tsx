"use client";
// CONFIRM1 — components/ConfirmDialog.tsx (hop xac nhan dung chung)
// Cung layout chuan nhu AlertDialog: giua man hinh, nen trong suot
// (bam ngoai hoac Esc de huy), khong gioi han chieu cao.
// Dung: {confirmReq && <ConfirmDialog message={...} confirmLabel={...} onConfirm={...} onCancel={...} />}
import { useEffect } from "react";

export default function ConfirmDialog({ message, confirmLabel = "Xác nhận", onConfirm, onCancel }: { message: string; confirmLabel?: string; onConfirm: () => void; onCancel: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-transparent p-4" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warning-soft text-base text-warning">⚠</span>
          <p className="pt-1.5 text-sm leading-relaxed text-ink">{message}</p>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className="cb-btn-ghost px-4 py-2 text-sm">Huỷ</button>
          <button onClick={onConfirm} className="cb-btn-primary px-5 py-2 text-sm">{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
