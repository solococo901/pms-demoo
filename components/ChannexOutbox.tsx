"use client";

// ============================================================
// BO GUI NEN CHANNEX — components/ChannexOutbox.tsx
// Gan trong khung app (layout). Tu chay: khi mo app, moi 60
// giay, va ngay khi co muc moi vao hang doi (su kien
// "channex-outbox"). Gui hang doi cua MOI khach san da ket noi
// Channex. Hien 1 chip nho goc duoi phai bao trang thai dong
// bo — bang chung song cho buoi kiem dinh Channex.
// ============================================================

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { supabase } from "@/lib/supabase";
import { countPendingOutbox, drainChannexOutbox, getChannexQueueErrors, patchChannelSettings, retryChannexQueue, type QueueError } from "@/lib/channex-outbox";

type Conn = { hotelId: string; propertyId: string };

export default function ChannexOutbox() {
  const [conns, setConns] = useState<Conn[]>([]);
  const [pending, setPending] = useState(0);
  const [lastOk, setLastOk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queueErrors, setQueueErrors] = useState<QueueError[]>([]);
  const draining = useRef(false);

  useEffect(() => {
    supabase
      .from("channel_connections")
      .select("hotel_id, external_property_id, status")
      .eq("provider", "channex")
      .eq("status", "connected")
      .then(({ data }) => {
        const list = (data ?? [])
          .filter((c) => c.external_property_id)
          .map((c) => ({ hotelId: c.hotel_id, propertyId: c.external_property_id as string }));
        setConns(list);
      });
  }, []);

  const refreshPending = useCallback(async (list: Conn[]) => {
    let total = 0;
    for (const c of list) total += await countPendingOutbox(c.hotelId).catch(() => 0);
    setPending(total);
  }, []);

  const drain = useCallback(async () => {
    if (conns.length === 0 || draining.current) return;
    draining.current = true;
    try {
      let sentAny = false;
      for (const c of conns) {
        const r = await drainChannexOutbox(c.hotelId, c.propertyId);
        if (r.sent > 0) {
          sentAny = true;
          // Ghi dau thoi gian de trang Kênh bán hiện "Đồng bộ gần nhất" thật.
          void patchChannelSettings(c.hotelId, { last_sync_at: new Date().toISOString() });
        }
      }
      if (sentAny) {
        setLastOk(
          new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })
        );
        setError(null);
      }
      await refreshPending(conns);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lỗi gửi Channex");
      await refreshPending(conns);
    } finally {
      draining.current = false;
    }
  }, [conns, refreshPending]);

  useEffect(() => {
    if (conns.length === 0) return;
    drain();
    const onNew = () => drain();
    window.addEventListener("channex-outbox", onNew);
    const t = setInterval(drain, 60000);
    return () => {
      window.removeEventListener("channex-outbox", onNew);
      clearInterval(t);
    };
  }, [conns, drain]);

  // Nghe loi tinh gia tri Channex (ngay rot khoi hang doi):
  // truoc day loi nay chi nam trong console, chip van hien
  // "da dong bo". Gio chip canh bao va cho bam de thu lai.
  useEffect(() => {
    const onQueueError = () => setQueueErrors(getChannexQueueErrors());
    window.addEventListener("channex-queue-error", onQueueError);
    onQueueError();
    return () => window.removeEventListener("channex-queue-error", onQueueError);
  }, []);

  const retryQueue = useCallback(async () => {
    for (const q of queueErrors) {
      try {
        await retryChannexQueue(q.hotelId);
      } catch {
        // Loi van con — giu lai de chip van canh bao.
      }
    }
    setQueueErrors(getChannexQueueErrors());
    await drain();
  }, [queueErrors, drain]);

  if (conns.length === 0) return null;

  const queueDates = queueErrors.reduce((n, q) => n + q.dates.length, 0);
  const hasQueueError = queueErrors.length > 0;
  const style: CSSProperties = {
    position: "fixed",
    right: 16,
    bottom: 16,
    zIndex: 50,
    borderRadius: 999,
    padding: "6px 12px",
    fontSize: 12,
    boxShadow: "0 2px 8px rgba(23,41,62,0.18)",
    cursor: error || hasQueueError ? "pointer" : "default",
    background: error ? "#fdecec" : hasQueueError || pending > 0 ? "#fdf3e3" : "#e8f7f1",
    color: error ? "#b42318" : hasQueueError || pending > 0 ? "#9a6a12" : "#0d7a55",
    border: "1px solid #dde3ea",
  };
  const text = error
    ? `Channex: ⚠️ lỗi gửi — bấm để thử lại`
    : hasQueueError
      ? `Channex: ⚠ ${queueDates} ngày chưa tính được — bấm để thử lại`
      : pending > 0
        ? `Channex: ⏳ ${pending} mục đang chờ gửi`
        : `Channex: ✓ đã đồng bộ${lastOk ? ` lúc ${lastOk}` : ""}`;
  const onClick = error ? drain : hasQueueError ? () => void retryQueue() : undefined;
  const title = error ?? (hasQueueError ? queueErrors.map((q) => q.message).join("; ") : undefined);

  return (
    <div style={style} onClick={onClick} title={title}>
      {text}
    </div>
  );
}
