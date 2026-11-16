"use client";
// ============================================================
// FILE 11 — app/settings/page.tsx (Cloudbeds style)
// SETTINGS2 (2026-11-13): nut "Luu cai dat" ghi THAT vao bang
// system_settings (file SQL 17) thay cho luu gia; nut bat/tat
// dong bo dem cung luu ngay khi bam. Tai lai trang van giu
// nguyen gia tri da luu.
// SYSTEM-WIDE settings only (restructured 2026-10-22).
//
// The product manages many hotels, so hotel data does NOT
// live here anymore:
//   - Hotels list + add hotel      -> /hotels
//   - One hotel's profile, room
//     types, rooms, rate plans     -> /hotels/[id]
//   - Channex account + channels   -> /channels
// What stays here: options that apply to the WHOLE system —
// language, timezone, currency, date format — plus a preview
// of user roles (real login + permission enforcement is
// Round B work).
// Logic unchanged from the first version — colors only.
// ============================================================

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

const inputCls = "rounded-lg border border-[#dde3ea] px-3 py-2 text-sm text-[#17293e] outline-none focus:border-[#2563eb]";

const ACCOUNT_ID = "11111111-1111-1111-1111-111111111111";

const ROLES = [
  {
    name: "Quản trị viên (Admin)",
    desc: "Toàn quyền: mọi khách sạn, giá theo kênh, kênh bán, cài đặt hệ thống.",
  },
  {
    name: "Lễ tân (Staff)",
    desc: "Chỉ khách sạn được phân công: lịch phòng, đặt phòng, check-in/out. Không thấy giá kênh, không vào được Cài đặt.",
  },
  {
    name: "Buồng phòng (Housekeeping)",
    desc: "Chỉ xem trạng thái phòng và cập nhật dọn phòng của khách sạn được phân công.",
  },
];

export default function SettingsPage() {
  // Trang nay nam duoi /<ten-khach-san>/... nen ma khach san lay tu URL.
  const params = useParams();
  const hotelId = typeof params.hotelId === "string" ? params.hotelId : "";
  const channelsHref = hotelId ? `/${hotelId}/channels` : "/channels";
  const [general, setGeneral] = useState({
    language: "vi",
    timezone: "Asia/Ho_Chi_Minh",
    currency: "VND",
    dateFormat: "dd/MM/yyyy",
  });
  const [nightlySync, setNightlySync] = useState(true);
  const [savedMsg, setSavedMsg] = useState("");
  const [saveErr, setSaveErr] = useState("");
  const [syncMsg, setSyncMsg] = useState("");
  const [loadErr, setLoadErr] = useState("");

  // Doc cai dat da luu (bang system_settings, file SQL 17).
  // Chua co dong nao thi giu mac dinh tren form.
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("system_settings")
        .select("language, timezone, currency, date_format, nightly_sync")
        .eq("account_id", ACCOUNT_ID)
        .maybeSingle();
      if (error) {
        setLoadErr("Chưa đọc được cài đặt đã lưu — kiểm tra xem đã chạy file SQL 17 (system_settings) trên Supabase chưa. Lỗi: " + error.message);
        return;
      }
      if (!data) return;
      setGeneral({
        language: data.language,
        timezone: data.timezone,
        currency: data.currency,
        dateFormat: data.date_format,
      });
      setNightlySync(data.nightly_sync);
    })();
  }, []);

  // Ghi THAT vao co so du lieu (upsert theo account_id).
  async function saveSettings(nextGeneral: typeof general, nextNightly: boolean) {
    setSavedMsg("");
    setSaveErr("");
    setSyncMsg("");
    const { error } = await supabase.from("system_settings").upsert({
      account_id: ACCOUNT_ID,
      language: nextGeneral.language,
      timezone: nextGeneral.timezone,
      currency: nextGeneral.currency,
      date_format: nextGeneral.dateFormat,
      nightly_sync: nextNightly,
    });
    if (error) {
      setSaveErr("Lưu không thành công: " + error.message);
      return false;
    }
    return true;
  }

  async function saveGeneral() {
    if (await saveSettings(general, nightlySync)) setSavedMsg("Đã lưu cài đặt.");
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#17293e]">Cài đặt hệ thống</h1>
      <p className="mt-1 text-sm text-[#68707a]">
        Chỉ những tuỳ chọn áp dụng cho <b className="text-[#17293e]">toàn hệ thống</b>. Dữ liệu của từng khách sạn nằm ở mục{" "}
        <Link href="/hotels" className="text-[#2563eb] hover:underline">Khách sạn</Link>, tài khoản Channex nằm ở mục{" "}
        <Link href={channelsHref} className="text-[#2563eb] hover:underline">Kênh bán</Link>.
      </p>
      {loadErr && <p className="mt-3 rounded-lg bg-[#fef3c7] px-3 py-2 text-sm text-[#92400e]">{loadErr}</p>}

      {/* ===== general system options ===== */}
      <section className="cb-card mt-6 p-5">
        <h2 className="text-base font-bold text-[#17293e]">Tuỳ chọn chung</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm text-[#17293e]">
            Ngôn ngữ giao diện
            <select value={general.language} onChange={(e) => setGeneral({ ...general, language: e.target.value })} className={`${inputCls} mt-1 w-full`}>
              <option value="vi">Tiếng Việt</option>
              <option value="en" disabled>English (có ở vòng i18n)</option>
            </select>
          </label>
          <label className="text-sm text-[#17293e]">
            Múi giờ hệ thống
            <select value={general.timezone} onChange={(e) => setGeneral({ ...general, timezone: e.target.value })} className={`${inputCls} mt-1 w-full`}>
              <option value="Asia/Ho_Chi_Minh">Việt Nam (UTC+7)</option>
              <option value="Asia/Bangkok">Bangkok (UTC+7)</option>
              <option value="Asia/Singapore">Singapore (UTC+8)</option>
            </select>
          </label>
          <label className="text-sm text-[#17293e]">
            Tiền tệ mặc định
            <select value={general.currency} onChange={(e) => setGeneral({ ...general, currency: e.target.value })} className={`${inputCls} mt-1 w-full`}>
              <option value="VND">VND — Việt Nam đồng</option>
              <option value="USD">USD — Đô la Mỹ</option>
            </select>
          </label>
          <label className="text-sm text-[#17293e]">
            Định dạng ngày
            <select value={general.dateFormat} onChange={(e) => setGeneral({ ...general, dateFormat: e.target.value })} className={`${inputCls} mt-1 w-full`}>
              <option value="dd/MM/yyyy">Ngày/Tháng/Năm (21/10/2026)</option>
              <option value="MM/dd/yyyy">Tháng/Ngày/Năm (10/21/2026)</option>
            </select>
          </label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={saveGeneral}
            className="cb-btn-primary px-4 py-2 text-sm"
          >
            Lưu cài đặt
          </button>
          {savedMsg && <span className="text-sm text-[#0e7a56]">{savedMsg}</span>}
          {saveErr && <span className="text-sm text-[#e5484d]">{saveErr}</span>}
        </div>
      </section>

      {/* ===== sync behaviour ===== */}
      <section className="cb-card mt-6 p-5">
        <h2 className="text-base font-bold text-[#17293e]">Đồng bộ dữ liệu</h2>
        <div className="mt-3 flex items-center justify-between gap-4">
          <div className="text-sm text-[#17293e]">
            <b>Đồng bộ toàn bộ mỗi đêm với Channex</b>
            <p className="mt-0.5 text-[#68707a]">
              Mỗi đêm hệ thống đối chiếu lại toàn bộ giá và quỹ phòng của mọi khách sạn với Channex, để sửa mọi lệch lạc tích tụ trong ngày.
              Áp dụng cho tất cả khách sạn trong hệ thống.
            </p>
          </div>
          <button
            onClick={async () => {
              const next = !nightlySync;
              setNightlySync(next);
              if (await saveSettings(general, next)) setSyncMsg("Đã lưu.");
            }}
            className={`h-6 w-11 shrink-0 rounded-full p-0.5 transition ${nightlySync ? "bg-[#1db584]" : "bg-[#ccd5df]"}`}
            title="Bật/tắt đồng bộ đêm"
          >
            <span className={`block h-5 w-5 rounded-full bg-white transition ${nightlySync ? "translate-x-5" : ""}`} />
          </button>
        </div>
        {syncMsg && <p className="mt-3 text-sm text-[#0e7a56]">{syncMsg}</p>}
      </section>

      {/* ===== users & roles (live, Round D2b) ===== */}
      <UsersSection />
    </div>
  );
}

type Profile = {
  user_id: string;
  display_name: string | null;
  role: string;
  created_at: string;
};

// Danh sach nguoi dung cua tai khoan + doi vai tro bang o chon.
// Admin doc/duoc sua nho policy o SQL 11 (11-roles-admin.sql).
// Khong duoc tu doi vai tro cua CHINH MINH o day (tranh tu khoa
// tai khoan quan tri cuoi cung — doi qua SQL neu that su can).
function UsersSection() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [myId, setMyId] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      setMyId(u.user?.id ?? "");
      const { data, error } = await supabase
        .from("user_profiles")
        .select("user_id, display_name, role, created_at")
        .order("created_at");
      if (error) setErr(error.message);
      else setProfiles(data ?? []);
    })();
  }, []);

  async function changeRole(p: Profile, role: string) {
    setErr("");
    setMsg("");
    const { error } = await supabase
      .from("user_profiles")
      .update({ role })
      .eq("user_id", p.user_id);
    if (error) return setErr(error.message);
    setProfiles((prev) => prev.map((x) => (x.user_id === p.user_id ? { ...x, role } : x)));
    setMsg(
      `Đã đổi vai trò của ${p.display_name ?? "người dùng"} thành ${
        role === "admin" ? "Quản trị viên" : "Nhân viên"
      }. Người đó tải lại trang là áp dụng ngay.`
    );
  }

  return (
    <section className="cb-card mt-6 p-5">
      <h2 className="text-base font-bold text-[#17293e]">Người dùng & vai trò</h2>
      <p className="mt-0.5 text-sm text-[#68707a]">
        Ai được xem gì trong hệ thống. Đổi vai trò có hiệu lực khi người đó tải lại trang.
      </p>
      {err && <p className="mt-3 rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#e5484d]">Lỗi cơ sở dữ liệu: {err}</p>}
      <div className="mt-4 space-y-2">
        {profiles.map((p) => (
          <div key={p.user_id} className="flex flex-wrap items-center gap-3 rounded-lg border border-[#eef1f5] px-4 py-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#17293e] text-sm font-semibold text-white">
              {(p.display_name ?? "?").charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-[#17293e]">
                {p.display_name ?? "(chưa đặt tên)"}
                {p.user_id === myId && <span className="ml-2 rounded bg-[#e8effe] px-1.5 py-0.5 text-[11px] font-semibold text-[#2563eb]">bạn</span>}
              </div>
              <div className="text-xs text-[#68707a]">Từ {String(p.created_at).slice(0, 10)}</div>
            </div>
            <select
              value={p.role}
              disabled={p.user_id === myId}
              onChange={(e) => changeRole(p, e.target.value)}
              className={`${inputCls} ${p.user_id === myId ? "opacity-50" : ""}`}
              title={p.user_id === myId ? "Không tự đổi vai trò của chính mình tại đây" : "Đổi vai trò"}
            >
              <option value="admin">Quản trị viên</option>
              <option value="staff">Nhân viên</option>
            </select>
          </div>
        ))}
        {profiles.length === 0 && !err && (
          <p className="text-sm text-[#68707a]">Đang tải danh sách người dùng...</p>
        )}
      </div>
      {msg && <p className="mt-3 text-sm text-[#0e7a56]">{msg}</p>}
      <p className="mt-3 text-xs text-[#68707a]">
        Thêm người dùng mới: tạo tài khoản trong Supabase (Authentication → Users), rồi gắn hồ sơ bằng câu lệnh SQL đã dùng ở bước tạo nhân viên thử.
      </p>
      <div className="mt-4 space-y-3">
        {ROLES.map((r) => (
          <div key={r.name} className="rounded-lg border border-[#eef1f5] px-4 py-3">
            <div className="text-sm font-semibold text-[#17293e]">{r.name}</div>
            <div className="mt-0.5 text-sm text-[#68707a]">{r.desc}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
