"use client";
// AlertDialog — hop thong bao dep thay cho alert() cua trinh duyet (theo chuan NateUI/Cloudbeds).
// Dung: {alertMsg && <AlertDialog message={alertMsg} onClose={() => setAlertMsg(null)} />}
// Bam ra ngoai nen mo hoac bam nut "Đã hiểu" deu dong hop.

export default function AlertDialog({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-transparent p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warning-soft text-base text-warning">⚠</span>
          <p className="pt-1.5 text-sm leading-relaxed text-ink">{message}</p>
        </div>
        <div className="mt-5 flex justify-end">
          <button onClick={onClose} className="cb-btn-primary px-5 py-2 text-sm">Đã hiểu</button>
        </div>
      </div>
    </div>
  );
}
