"use client";

// CHANOUT2 — components/ChannexOutbox.tsx (chip hang doi dong bo Channex)
// Gan trong khung app; tu chay moi 60 giay va ngay khi co muc moi vao hang doi; hien 1 chip nho goc duoi TRAI bao trang thai dong bo.
// Chi hien "da dong bo" khi dong bo that: dang cho (chua tinh xong / dang gui / chua tai xong so dem) thi hien "dang cho gui" / "dang kiem tra".

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { supabase } from "@/lib/supabase";
import { countPendingOutbox, drainChannexOutbox, getChannexQueueErrors, patchChannelSettings, retryChannexQueue, type QueueError } from "@/lib/channex-outbox";

type Conn = { hotelId: string; propertyId: string };

export default function ChannexOutbox() {
  const [conns, setConns] = useState<Conn[]>([]);
  // pending = null: chua tai xong so dem (mo trang) — chua duoc hien "da dong bo".
  const [pending, setPending] = useState<number | null>(null);
  const [lastOk, setLastOk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queueErrors, setQueueErrors] = useState<QueueError[]>([]);
  // dirty: co thay doi moi (da bam luu gia/don/chan phong) nhung chua
  // xac nhan Channex da nhan. Dat ngay khi co su kien channex-pending
  // (truoc ca 1,5 giay gom ngay), xoa khi drain xong va so dem ve 0.
  const [dirty, setDirty] = useState(false);
  // Co thay doi nao chen vao GIUA luc drain dang chay khong — neu co
  // thi drain nay khong duoc xoa dirty (thay doi do con dang cho).
  const dirtyDuringDrain = useRef(false);
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

  const refreshPending = useCallback(async (list: Conn[]): Promise<number> => {
    let total = 0;
    for (const c of list) total += await countPendingOutbox(c.hotelId).catch(() => 0);
    setPending(total);
    return total;
  }, []);

  const drain = useCallback(async () => {
    if (conns.length === 0 || draining.current) return;
    draining.current = true;
    dirtyDuringDrain.current = false;
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
      const total = await refreshPending(conns);
      // Chi xoa dirty khi drain xong, so dem ve 0, va khong co thay
      // doi nao chen vao giua luc drain dang chay.
      if (total === 0 && !dirtyDuringDrain.current) setDirty(false);
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

  // Thay doi moi vua duoc bam luu (gia/don/chan phong): chip chuyen
  // ngay sang "dang cho gui", khong cho hien "da dong bo" cu.
  useEffect(() => {
    const onPending = () => {
      setDirty(true);
      dirtyDuringDrain.current = true;
    };
    window.addEventListener("channex-pending", onPending);
    return () => window.removeEventListener("channex-pending", onPending);
  }, []);

  // Nghe loi tinh gia tri Channex (ngay rot khoi hang doi) — truoc day loi nay chi nam trong console, chip van hien "da dong bo".
  // Gio chip canh bao va cho bam de thu lai.
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
    left: 16,
    bottom: 16,
    zIndex: 50,
    borderRadius: 999,
    padding: "6px 12px",
    fontSize: 12,
    boxShadow: "var(--nui-shadow-card)",
    cursor: error || hasQueueError ? "pointer" : "default",
    background: error ? "var(--nui-danger-soft)" : hasQueueError || dirty || pending === null || (pending ?? 0) > 0 ? "var(--nui-warning-soft)" : "var(--nui-success-soft)",
    color: error ? "var(--nui-danger)" : hasQueueError || dirty || pending === null || (pending ?? 0) > 0 ? "var(--nui-warning)" : "var(--nui-success)",
    border: "1px solid var(--nui-border)",
  };
  const waiting = dirty || pending === null || (pending ?? 0) > 0;
  const text = error
    ? `Channex: ⚠️ lỗi gửi — bấm để thử lại`
    : hasQueueError
      ? `Channex: ⚠ ${queueDates} ngày chưa tính được — bấm để thử lại`
      : pending === null
        ? `Channex: ⏳ đang kiểm tra...`
        : waiting
          ? (pending ?? 0) > 0
            ? `Channex: ⏳ ${pending} mục đang chờ gửi`
            : `Channex: ⏳ đang chờ gửi`
          : `Channex: ✓ đã đồng bộ${lastOk ? ` lúc ${lastOk}` : ""}`;
  const onClick = error ? drain : hasQueueError ? () => void retryQueue() : undefined;
  const title = error ?? (hasQueueError ? queueErrors.map((q) => q.message).join("; ") : undefined);

  return (
    <div style={style} onClick={onClick} title={title}>
      {text}
    </div>
  );
}
