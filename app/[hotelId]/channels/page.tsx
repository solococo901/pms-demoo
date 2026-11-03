"use client";
// ============================================================
// FILE 10 — app/channels/page.tsx (Cloudbeds style)
// Channels page: connection status of every sales channel.
//   - OTA channels connect THROUGH Channex (one connection to
//     Channex = all OTAs). The top box holds the Channex
//     account: environment + API key (password field — the key
//     is a secret; in Round B it is stored server-side only).
//   - Direct channels (Website, Front Desk) need no connection.
//   - Per channel: active on/off, commission %, status, and
//     "last sync" time. Buttons are simulated in this phase —
//     Round B calls the real Channex API (mapping + status).
// Logic unchanged from the first version — colors only.
// ============================================================

import { useState } from "react";
import { CHANNELS } from "@/lib/mock-data";
import ChannexSetup from "@/components/ChannexSetup";
import ChannexSync from "@/components/ChannexSync";
import ChannexBookings from "@/components/ChannexBookings";

type ChannelState = {
  code: string;
  connected: boolean;
  active: boolean;
  commission: number; // % the channel keeps from each booking
  lastSync: string;
};

const INITIAL: ChannelState[] = [
  { code: "website", connected: true, active: true, commission: 0, lastSync: "—" },
  { code: "frontdesk", connected: true, active: true, commission: 0, lastSync: "—" },
  { code: "booking_com", connected: true, active: true, commission: 15, lastSync: "5 phút trước" },
  { code: "expedia", connected: true, active: true, commission: 18, lastSync: "5 phút trước" },
  { code: "airbnb", connected: false, active: false, commission: 14, lastSync: "chưa từng" },
  { code: "agoda", connected: true, active: false, commission: 16, lastSync: "2 giờ trước" },
];

const inputCls = "rounded-lg border border-[#dde3ea] px-3 py-2 text-[#17293e] outline-none focus:border-[#2563eb]";

export default function ChannelsPage() {
  const [states, setStates] = useState<ChannelState[]>(INITIAL);
  const [environment, setEnvironment] = useState<"staging" | "production">("staging");
  const [channexStatus, setChannexStatus] = useState<"unchecked" | "checking" | "ok" | "error">("unchecked");
  const [channexMsg, setChannexMsg] = useState("");
  const [channexProps, setChannexProps] = useState<{ id: string; title: string }[]>([]);

  // REAL connection test: the browser asks our own server
  // route, which holds the API key (see app/api/channex/test).
  async function testChannex() {
    setChannexStatus("checking");
    setChannexMsg("");
    try {
      const res = await fetch("/api/channex/test");
      const data = await res.json();
      if (data.env) setEnvironment(data.env);
      if (data.ok) {
        setChannexStatus("ok");
        setChannexProps(data.properties ?? []);
        setChannexMsg(
          `Đã nối được tới Channex (${data.env}). Tài khoản có ${data.count} property.`
        );
      } else {
        setChannexStatus("error");
        setChannexProps([]);
        setChannexMsg(data.error ?? "Không kết nối được.");
      }
    } catch {
      setChannexStatus("error");
      setChannexMsg("Không gọi được route kiểm tra của ứng dụng.");
    }
  }

  function patch(code: string, change: Partial<ChannelState>) {
    setStates((prev) => prev.map((s) => (s.code === code ? { ...s, ...change } : s)));
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#17293e]">Kênh bán</h1>
      <p className="mt-1 text-sm text-[#68707a]">
        Các OTA nối qua Channex — một kết nối tới Channex là đủ cho mọi OTA. Website và Lễ tân bán trực tiếp trong PMS.
      </p>

      {/* Channex account box */}
      <div className="cb-card mt-5 p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-[#17293e]">Tài khoản Channex</h2>
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${channexStatus === "ok" ? "bg-[#e6f7f1] text-[#0e7a56]" : channexStatus === "error" ? "bg-[#fdecec] text-[#e5484d]" : "bg-[#eef1f5] text-[#68707a]"}`}>
            {channexStatus === "ok" ? "● Kết nối tốt" : channexStatus === "error" ? "● Kết nối lỗi" : channexStatus === "checking" ? "● Đang kiểm tra..." : "○ Chưa kiểm tra"}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-sm text-[#17293e]">
            Môi trường (đọc từ máy chủ)
            <select value={environment} disabled className={`${inputCls} mt-1 block opacity-70`}>
              <option value="staging">Staging (thử nghiệm)</option>
              <option value="production">Production (chạy thật)</option>
            </select>
          </label>
          <div className="flex-1 rounded-lg bg-[#f4f7fb] px-3 py-2 text-sm text-[#68707a]">
            API key được đọc từ file <b className="text-[#17293e]">.env.local</b> phía máy chủ —
            trình duyệt không bao giờ nhìn thấy key.
          </div>
          <button
            onClick={testChannex}
            disabled={channexStatus === "checking"}
            className="cb-btn-primary px-4 py-2 text-sm disabled:opacity-60"
          >
            {channexStatus === "checking" ? "Đang kiểm tra..." : "Kiểm tra kết nối"}
          </button>
        </div>
        <p className="mt-2 text-xs text-[#68707a]">
          Đang ở môi trường <b className="text-[#17293e]">{environment}</b>:
          {environment === "staging" ? " dùng để học và test, không bán phòng thật." : " bán phòng thật — cần qua kiểm duyệt (certification) của Channex."}
        </p>
        {channexMsg && (
          <p className={`mt-2 rounded-lg px-3 py-2 text-sm ${channexStatus === "ok" ? "bg-[#e6f7f1] text-[#0e7a56]" : "bg-[#fdecec] text-[#e5484d]"}`}>
            {channexMsg}
          </p>
        )}
        {channexProps.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm text-[#17293e]">
            {channexProps.map((pr) => (
              <li key={pr.id} className="rounded-lg bg-[#f4f7fb] px-3 py-1.5">
                🏨 {pr.title} <span className="text-xs text-[#68707a]">({pr.id})</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ChannexSetup />
      <ChannexSync />
      <ChannexBookings />

      {/* one card per channel */}
      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {CHANNELS.map((c) => {
          const s = states.find((x) => x.code === c.code)!;
          const isOta = c.type === "ota";
          return (
            <div key={c.code} className="cb-card p-5">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-bold text-[#17293e]">{c.name}</div>
                  <div className="text-xs text-[#68707a]">
                    {c.type === "direct" ? "Kênh trực tiếp" : c.type === "offline" ? "Tại quầy" : "OTA — qua Channex"}
                  </div>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                  !isOta ? "bg-[#eef1f5] text-[#68707a]" : s.connected ? "bg-[#e6f7f1] text-[#0e7a56]" : "bg-[#fdecec] text-[#e5484d]"
                }`}>
                  {!isOta ? "Trong PMS" : s.connected ? "Đã kết nối" : "Chưa kết nối"}
                </span>
              </div>

              <div className="mt-4 space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-[#68707a]">Đang bán trên kênh này</span>
                  <button
                    onClick={() => patch(c.code, { active: !s.active })}
                    className={`h-6 w-11 rounded-full p-0.5 transition ${s.active ? "bg-[#1db584]" : "bg-[#ccd5df]"}`}
                    title="Bật/tắt bán trên kênh này"
                  >
                    <span className={`block h-5 w-5 rounded-full bg-white transition ${s.active ? "translate-x-5" : ""}`} />
                  </button>
                </div>
                {isOta && (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-[#68707a]">Hoa hồng kênh thu</span>
                      <span className="text-[#17293e]">
                        <input
                          type="number"
                          value={s.commission}
                          onChange={(e) => patch(c.code, { commission: Number(e.target.value) })}
                          className="w-16 rounded border border-[#dde3ea] px-2 py-1 text-right outline-none focus:border-[#2563eb]"
                        /> %
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#68707a]">Đồng bộ gần nhất</span>
                      <span className="text-[#17293e]">{s.lastSync}</span>
                    </div>
                  </>
                )}
              </div>

              {isOta && (
                <button
                  onClick={() => patch(c.code, { connected: true, lastSync: "vừa xong" })}
                  className="cb-btn-ghost mt-4 w-full py-2 text-sm"
                >
                  {s.connected ? "Đồng bộ ngay" : "Kết nối kênh này qua Channex"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-xs text-[#68707a]">
        Tình huống trong dữ liệu mẫu: Agoda đã kết nối nhưng đang <b className="text-[#17293e]">tắt bán</b>, Airbnb <b className="text-[#17293e]">chưa kết nối</b> — hai trạng thái hoàn toàn khác nhau, trang này phải phân biệt rõ.
      </p>
    </div>
  );
}
