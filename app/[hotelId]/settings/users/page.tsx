"use client";
// USERS4 — app/[hotelId]/settings/users/page.tsx (Nguoi dung, chi Admin)
// Tieu de gon lai; form them chi hien khi bam nut Them (mac dinh an).
// 2 tab Nguoi dung | Vai tro; khoa service_role nhap ngay tren trang, luu vao bang admin_secrets (SQL 21).

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { IconBan, IconCheckCircle, IconEdit, IconPlus, IconTrash, IconUser } from "@/components/icons";

const inputCls =
  "rounded-lg border border-line px-3 py-2 text-sm text-ink outline-none focus:border-primary";

const ROLES = [
  { value: "admin", label: "Admin" },
  { value: "manager", label: "Quản lý tòa" },
  { value: "staff", label: "Lễ tân" },
  { value: "housekeeping", label: "Buồng phòng" },
];

// Moi vai tro 1 cau mo ta bang tieng Viet doi thuong — noi ro lam duoc gi va khong lam duoc gi (hom nay).
const ROLE_PROMISE: Record<string, string> = {
  admin: "Toàn quyền: mọi khách sạn, giá, kênh bán, báo cáo, cài đặt, quản lý người dùng. Chỉ nên có 1–2 người.",
  manager:
    "Quản lý tòa — hiện dùng chung mức Lễ tân (xem lịch, đặt phòng, check-in/out, thu tiền; không thấy giá kênh, báo cáo và cài đặt). Chờ bảng phân quyền của sếp.",
  staff: "Lễ tân — xem lịch, đặt phòng, check-in/out, thu tiền; không thấy giá kênh, báo cáo và cài đặt.",
  housekeeping:
    "Buồng phòng — hiện dùng chung mức Lễ tân; sau này chỉ thấy báo cáo buồng phòng + trạng thái phòng. Chờ bảng phân quyền của sếp.",
};

// Bang quyen THUC TE hom nay (chi-doc). Quan ly toa / Le tan / Buong phong deu dung muc Le tan
// nen 3 cot giong nhau — do la su that hien tai, khong phai loi hien thi.
const MATRIX: { label: string; caps: Record<string, boolean> }[] = [
  { label: "Xem Tổng quan & Lịch phòng", caps: { admin: true, manager: true, staff: true, housekeeping: true } },
  { label: "Tạo / sửa / huỷ đặt phòng", caps: { admin: true, manager: true, staff: true, housekeeping: true } },
  { label: "Check-in / trả phòng / ghi chú", caps: { admin: true, manager: true, staff: true, housekeeping: true } },
  { label: "Thu tiền & ghi nhận thanh toán", caps: { admin: true, manager: true, staff: true, housekeeping: true } },
  { label: "Xem & sửa giá theo kênh", caps: { admin: true, manager: false, staff: false, housekeeping: false } },
  { label: "Xem báo cáo", caps: { admin: true, manager: false, staff: false, housekeeping: false } },
  { label: "Cài đặt khách sạn, loại phòng, kênh bán", caps: { admin: true, manager: false, staff: false, housekeeping: false } },
  { label: "Đổi trạng thái dọn phòng", caps: { admin: true, manager: false, staff: false, housekeeping: false } },
  { label: "Quản lý người dùng & vai trò", caps: { admin: true, manager: false, staff: false, housekeeping: false } },
];

type UserRow = {
  userId: string;
  email: string;
  displayName: string;
  role: string;
  roleLabel: string;
  banned: boolean;
  createdAt: string;
  lastSignInAt: string | null;
};

type UnassignedRow = { userId: string; email: string; createdAt: string };

const fmtDateTime = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

async function api(path: string, init?: RequestInit) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...((init?.headers as Record<string, string>) ?? {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Lỗi ${res.status}`);
  return json;
}

export default function UsersPage() {
  const params = useParams();
  const hotelId = String(params.hotelId ?? "");
  const [tab, setTab] = useState<"users" | "roles">("users");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [unassigned, setUnassigned] = useState<UnassignedRow[]>([]);
  const [me, setMe] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [userQuery, setUserQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [compareRoles, setCompareRoles] = useState(false);

  // Trang thai cai dat khoa service_role (route tra ve).
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [needsSql, setNeedsSql] = useState(false);
  const [keyInvalid, setKeyInvalid] = useState(false);
  const [keySource, setKeySource] = useState<string | null>(null);
  // Form dan khoa (dung ca khi chua cai dat va khi Doi khoa).
  const [keyInput, setKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [keyError, setKeyError] = useState("");
  const [keyOk, setKeyOk] = useState(false);
  const [showKeyForm, setShowKeyForm] = useState(false);

  // Sua ten hien thi (mo form inline o dung dong do).
  const [editId, setEditId] = useState("");
  const [editName, setEditName] = useState("");

  // Form tao tai khoan moi.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState("staff");
  const [creating, setCreating] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  // Doi mat khau cho 1 nguoi (mo form inline o dung dong do).
  const [resetId, setResetId] = useState("");
  const [newPassword, setNewPassword] = useState("");

  // Gan vai tro cho tai khoan chua co ho so.
  const [assignName, setAssignName] = useState<Record<string, string>>({});
  const [assignRole, setAssignRole] = useState<Record<string, string>>({});

  async function load() {
    setError("");
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setMe(user?.id ?? "");
      const json = await api("/api/admin/users");
      setUsers(json.users ?? []);
      setUnassigned(json.unassigned ?? []);
      setSetupNeeded(!!json.setupNeeded);
      setNeedsSql(!!json.needsSql);
      setKeyInvalid(!!json.keyInvalid);
      setKeySource(json.keySource ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được danh sách.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveKey() {
    if (!keyInput.trim()) return;
    setKeyError("");
    setKeyOk(false);
    setSavingKey(true);
    try {
      await api("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({ action: "saveKey", key: keyInput.trim() }),
      });
      setKeyInput("");
      setKeyOk(true);
      setShowKeyForm(false);
      await load();
    } catch (e) {
      setKeyError(e instanceof Error ? e.message : "Không lưu được khóa.");
    } finally {
      setSavingKey(false);
    }
  }

  async function createUser() {
    if (!email.trim() || !password || !displayName.trim()) return setError("Nhập đủ email, mật khẩu và tên hiển thị.");
    setError("");
    setCreating(true);
    try {
      await api("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), password, displayName: displayName.trim(), role }),
      });
      setEmail("");
      setPassword("");
      setDisplayName("");
      setRole("staff");
      await load();
      setShowAddForm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tạo được tài khoản.");
    } finally {
      setCreating(false);
    }
  }

  async function patchUser(userId: string, body: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setError("");
    setBusy(userId + JSON.stringify(body.action));
    try {
      await api("/api/admin/users", { method: "PATCH", body: JSON.stringify({ userId, ...body }) });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thực hiện được.");
    } finally {
      setBusy("");
    }
  }

  async function deleteUser(u: UserRow) {
    if (!confirm(`Xóa hẳn tài khoản ${u.email} (${u.displayName || "chưa đặt tên"})? Người này sẽ không đăng nhập được nữa và hành động này không hoàn tác được.`)) return;
    setError("");
    setBusy("del-" + u.userId);
    try {
      await api("/api/admin/users", { method: "DELETE", body: JSON.stringify({ userId: u.userId }) });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không xóa được tài khoản.");
    } finally {
      setBusy("");
    }
  }

  const activeCount = users.filter((u) => !u.banned).length;
  const lockedCount = users.filter((u) => u.banned).length;

  const shownUsers = users.filter((u) => {
    const q = userQuery.trim().toLowerCase();
    if (q && !u.email.toLowerCase().includes(q) && !(u.displayName ?? "").toLowerCase().includes(q)) return false;
    if (roleFilter !== "all" && u.role !== roleFilter) return false;
    if (statusFilter === "active" && u.banned) return false;
    if (statusFilter === "locked" && !u.banned) return false;
    return true;
  });

  // Form dan khoa service_role (dung chung cho the cai dat va Doi khoa).
  function keyFormJsx() {
    return (
      <div>
        <p className="mt-1">
          Vào Supabase Dashboard → Project Settings → API → copy khóa <b>service_role</b> (dãy dài bắt đầu bằng eyJ — đừng
          lấy nhầm khóa anon). Dán vào ô dưới rồi bấm Lưu khóa. Hệ thống thử khóa ngay trước khi lưu — khóa sai sẽ báo luôn.
        </p>
        <div className="mt-2 flex gap-2">
          <input
            type={showKey ? "text" : "password"}
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="Dán khóa service_role vào đây"
            className={`${inputCls} block flex-1 bg-surface`}
          />
          <button type="button" onClick={() => setShowKey((v) => !v)} className="cb-btn-ghost shrink-0 px-3 text-sm">
            {showKey ? "Ẩn" : "Hiện"}
          </button>
        </div>
        {keyError && <p className="mt-2 text-danger">{keyError}</p>}
        {keyOk && <p className="mt-2 font-medium text-success">✓ Đã bật quản lý người dùng — danh sách tải lại bên dưới.</p>}
        <button
          onClick={saveKey}
          disabled={savingKey || !keyInput.trim()}
          className="cb-btn-primary mt-2 px-5 py-2.5 text-sm disabled:opacity-50"
        >
          {savingKey ? "Đang kiểm tra khóa..." : "Lưu khóa & bật quản lý người dùng"}
        </button>
        <p className="mt-2 text-xs">
          Khóa chỉ lưu trong cơ sở dữ liệu, chỉ Admin đọc được, không bao giờ hiện lại trên giao diện. Nếu anh đã thêm khóa vào
          .env.local thì không cần làm bước này (khóa trong file được ưu tiên).
        </p>
      </div>
    );
  }

  const tabCls = (t: "users" | "roles") =>
    `px-4 py-2 text-sm font-semibold ${tab === t ? "border-b-2 border-primary text-primary" : "text-muted hover:text-ink"}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/${hotelId}/settings`} className="text-sm font-medium text-primary hover:underline">
            ← Về Cài đặt
          </Link>
          <h1 className="mt-0.5 text-xl font-bold text-ink">Người dùng</h1>
          <p className="text-sm text-muted">Tạo tài khoản, gán vai trò, khóa/mở khóa và đặt lại mật khẩu cho nhân viên.</p>
        </div>
        {tab === "users" && !setupNeeded && (
          <button onClick={() => setShowAddForm((v) => !v)} className="cb-btn-primary shrink-0 px-4 py-2 text-sm">
            {showAddForm ? "✕ Đóng" : "＋ Thêm người dùng"}
          </button>
        )}
      </div>

      {/* ---------- the cai dat khoa (thay o loi do cu) ---------- */}
      {setupNeeded && (
        <div className="rounded-xl border border-line bg-warning-soft p-5 text-sm text-ink">
          <b className="text-base text-ink">Chưa bật được quản lý người dùng.</b>
          {keyInvalid ? (
            <p className="mt-1">
              Khóa đã lưu không dùng được nữa (có thể khóa đã đổi bên Supabase) — dán khóa mới vào ô dưới.
            </p>
          ) : (
            <p className="mt-1">
              Trang này cần 1 khóa service_role để tạo/khóa tài khoản. Làm theo 2 bước sau, xong dùng được ngay — không cần sửa
              file, không cần khởi động lại.
            </p>
          )}
          {needsSql && (
            <div className="mt-3">
              <b>Bước 1 — chạy file SQL (1 lần duy nhất).</b>
              <p className="mt-1">
                Mở Supabase Dashboard → SQL Editor, dán nội dung file <code>supabase/21-admin-secrets.sql</code> rồi bấm Run.
                File này tạo 1 bảng nhỏ chỉ Admin đọc được, để lưu khóa.
              </p>
              <button onClick={load} className="cb-btn-primary mt-2 px-4 py-2 text-sm">
                Đã chạy SQL — kiểm tra lại
              </button>
            </div>
          )}
          {!needsSql && (
            <div className="mt-3">
              <b>Bước 2 — dán khóa service_role.</b>
              {keyFormJsx()}
            </div>
          )}
        </div>
      )}

      {/* ---------- khoa da cau hinh bang bang (doi khoa) ---------- */}
      {!setupNeeded && keySource === "db" && (
        <div className="rounded-xl bg-[var(--nui-bg)] p-4 text-sm text-muted">
          <span className="font-medium text-success">✓ Khóa quản lý đã cấu hình</span> (lưu trong cơ sở dữ liệu, chỉ
          Admin đọc được).{" "}
          <button onClick={() => setShowKeyForm((v) => !v)} className="font-medium text-primary hover:underline">
            {showKeyForm ? "Ẩn form đổi khóa" : "Đổi khóa"}
          </button>
          {showKeyForm && <div className="mt-3 text-ink">{keyFormJsx()}</div>}
        </div>
      )}

      {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      {/* ---------- tab Nguoi dung / Vai tro ---------- */}
      <div className="flex gap-1 border-b border-line">
        <button onClick={() => setTab("users")} className={tabCls("users")}>
          Người dùng
        </button>
        <button onClick={() => setTab("roles")} className={tabCls("roles")}>
          Vai trò
        </button>
      </div>

      {tab === "users" && !setupNeeded && (
        <div className="space-y-4">
          {/* ---------- tao tai khoan moi (chi hien khi bam Them) ---------- */}
          {showAddForm && (
          <div className="cb-card space-y-3 p-5">
            <h2 className="flex items-center gap-2 text-base font-bold text-ink">
              <IconPlus className="h-5 w-5" /> Thêm người dùng mới
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-ink">
                Email *
                <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="VD: letan2@pms.local" className={`${inputCls} mt-1 block w-full`} />
              </label>
              <label className="text-sm text-ink">
                Mật khẩu * (từ 6 ký tự)
                <span className="mt-1 flex gap-2">
                  <input
                    type={showPw ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Đặt mật khẩu rồi báo cho nhân viên"
                    className={`${inputCls} block w-full`}
                  />
                  <button type="button" onClick={() => setShowPw((v) => !v)} className="cb-btn-ghost shrink-0 px-3 text-sm">
                    {showPw ? "Ẩn" : "Hiện"}
                  </button>
                </span>
              </label>
              <label className="text-sm text-ink">
                Tên hiển thị *
                <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="VD: Lễ tân Ca tối" className={`${inputCls} mt-1 block w-full`} />
              </label>
              <label className="text-sm text-ink">
                Vai trò
                <select value={role} onChange={(e) => setRole(e.target.value)} className={`${inputCls} mt-1 block w-full`}>
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs text-muted">{ROLE_PROMISE[role]}</span>
              </label>
            </div>
            <p className="text-xs text-muted">
              Tài khoản tạo xong đăng nhập được ngay, không cần xác nhận email. Ghi mật khẩu ra giấy cho nhân viên — mật khẩu không
              gửi qua email và không xem lại được sau này.
            </p>
            <div className="flex gap-2">
              <button onClick={createUser} disabled={creating} className="cb-btn-primary px-5 py-2.5 text-sm disabled:opacity-50">
                {creating ? "Đang tạo..." : "Tạo tài khoản"}
              </button>
              <button onClick={() => setShowAddForm(false)} className="cb-btn-ghost px-5 py-2.5 text-sm">
                Hủy
              </button>
            </div>
          </div>
          )}

          {/* ---------- danh sach ---------- */}
          <div className="cb-card overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
              <h2 className="text-base font-bold text-ink">
                Tài khoản trong hệ thống ({shownUsers.length}
                {userQuery.trim() || roleFilter !== "all" || statusFilter !== "all" ? ` / ${users.length}` : ""})
              </h2>
              <span className="text-sm text-muted">
                {activeCount} đang hoạt động · {lockedCount} đã khóa
              </span>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <input
                  value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                  placeholder="Tìm theo tên hoặc email..."
                  className={`${inputCls} w-56 px-3 py-1.5`}
                />
                <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className={`${inputCls} px-2 py-1.5`}>
                  <option value="all">Mọi vai trò</option>
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={`${inputCls} px-2 py-1.5`}>
                  <option value="all">Mọi trạng thái</option>
                  <option value="active">Đang hoạt động</option>
                  <option value="locked">Đã khóa</option>
                </select>
              </div>
            </div>
            {loading ? (
              <p className="p-5 text-sm text-muted">Đang tải danh sách...</p>
            ) : shownUsers.length === 0 ? (
              <p className="p-5 text-sm text-muted">
                {userQuery.trim() || roleFilter !== "all" || statusFilter !== "all"
                  ? "Không tìm thấy tài khoản nào khớp."
                  : "Chưa có tài khoản nào."}
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th className="px-5 py-2.5 font-semibold">Người dùng</th>
                    <th className="px-3 py-2.5 font-semibold">Vai trò</th>
                    <th className="px-3 py-2.5 font-semibold">Trạng thái</th>
                    <th className="px-3 py-2.5 font-semibold">Đăng nhập gần nhất</th>
                    <th className="px-3 py-2.5 font-semibold">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {shownUsers.map((u) => (
                    <tr key={u.userId} className="border-b border-[var(--nui-bg)] align-top">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                            <IconUser className="h-5 w-5" />
                          </span>
                          <span>
                            {editId === u.userId ? (
                              <span className="flex items-center gap-1.5">
                                <input
                                  value={editName}
                                  onChange={(e) => setEditName(e.target.value)}
                                  className={`${inputCls} w-44 px-2 py-1`}
                                  autoFocus
                                />
                                <button
                                  onClick={() => {
                                    patchUser(u.userId, { action: "displayName", displayName: editName });
                                    setEditId("");
                                  }}
                                  disabled={busy !== "" || !editName.trim()}
                                  className="cb-btn-primary px-2.5 py-1 text-xs disabled:opacity-40"
                                >
                                  Lưu
                                </button>
                                <button onClick={() => setEditId("")} className="cb-btn-ghost px-2.5 py-1 text-xs">
                                  Hủy
                                </button>
                              </span>
                            ) : (
                              <span className="flex items-center gap-1.5">
                                <span className="font-semibold text-ink">
                                  {u.displayName || "(chưa đặt tên)"}
                                  {u.userId === me && <span className="ml-2 rounded bg-[var(--nui-bg)] px-2 py-0.5 text-xs font-normal text-muted">bạn</span>}
                                </span>
                                <button
                                  onClick={() => {
                                    setEditId(u.userId);
                                    setEditName(u.displayName);
                                  }}
                                  title="Sửa tên hiển thị"
                                  className="flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-[var(--nui-bg)] hover:text-ink"
                                >
                                  <IconEdit className="h-3.5 w-3.5" />
                                </button>
                              </span>
                            )}
                            <span className="block text-xs text-muted">{u.email}</span>
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <select
                          value={u.role}
                          disabled={u.userId === me || busy !== ""}
                          onChange={(e) => patchUser(u.userId, { action: "role", role: e.target.value })}
                          className={`${inputCls} px-2 py-1.5`}
                          title={u.userId === me ? "Không tự đổi vai trò của chính mình" : "Đổi vai trò ngay trên dòng này"}
                        >
                          {ROLES.map((r) => (
                            <option key={r.value} value={r.value}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-3">
                        {u.banned ? (
                          <span className="rounded-full bg-danger-soft px-2.5 py-1 text-xs font-medium text-danger">Đã khóa</span>
                        ) : (
                          <span className="rounded-full bg-success-soft px-2.5 py-1 text-xs font-medium text-success">Hoạt động</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-muted">{fmtDateTime(u.lastSignInAt)}</td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-2">
                          {u.banned ? (
                            <button
                              onClick={() => patchUser(u.userId, { action: "unlock" }, `Mở khóa tài khoản ${u.email}? Người này đăng nhập lại được ngay.`)}
                              disabled={busy !== "" || u.userId === me}
                              className="cb-btn-ghost flex items-center gap-1 px-3 py-1.5 text-xs disabled:opacity-40"
                            >
                              <IconCheckCircle className="h-4 w-4" /> Mở khóa
                            </button>
                          ) : (
                            <button
                              onClick={() => patchUser(u.userId, { action: "lock" }, `Khóa tài khoản ${u.email}? Người này sẽ bị đăng xuất và không đăng nhập được nữa. Đặt phòng, ghi chú và lịch sử của họ vẫn giữ nguyên — mở khóa lại được bất cứ lúc nào.`)}
                              disabled={busy !== "" || u.userId === me}
                              className="cb-btn-ghost flex items-center gap-1 px-3 py-1.5 text-xs text-danger disabled:opacity-40"
                            >
                              <IconBan className="h-4 w-4" /> Khóa
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setResetId(resetId === u.userId ? "" : u.userId);
                              setNewPassword("");
                            }}
                            className="cb-btn-ghost flex items-center gap-1 px-3 py-1.5 text-xs"
                          >
                            <IconEdit className="h-4 w-4" /> Đổi mật khẩu
                          </button>
                          <button
                            onClick={() => deleteUser(u)}
                            disabled={busy !== "" || u.userId === me}
                            title={u.userId === me ? "Không tự xóa chính mình" : "Xóa hẳn tài khoản này"}
                            className="cb-btn-ghost flex items-center gap-1 px-3 py-1.5 text-xs text-danger disabled:opacity-40"
                          >
                            <IconTrash className="h-4 w-4" /> Xóa
                          </button>
                        </div>
                        {resetId === u.userId && (
                          <div className="mt-2 flex gap-2">
                            <input
                              type="text"
                              value={newPassword}
                              onChange={(e) => setNewPassword(e.target.value)}
                              placeholder="Mật khẩu mới (từ 6 ký tự)"
                              className={`${inputCls} w-48 px-2 py-1.5`}
                            />
                            <button
                              onClick={() => {
                                patchUser(u.userId, { action: "password", password: newPassword });
                                setResetId("");
                                setNewPassword("");
                              }}
                              disabled={busy !== "" || newPassword.length < 6}
                              className="cb-btn-primary px-3 py-1.5 text-xs disabled:opacity-40"
                            >
                              Lưu
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* ---------- tai khoan chua co ho so ---------- */}
          {unassigned.length > 0 && (
            <div className="cb-card space-y-3 p-5">
              <h2 className="text-base font-bold text-ink">Tài khoản chưa có hồ sơ ({unassigned.length})</h2>
              <p className="text-sm text-muted">
                Các tài khoản này đã có trong Supabase Auth nhưng chưa gắn vai trò — họ chưa đăng nhập được đúng quyền. Gán vai trò
                cho họ ở đây.
              </p>
              {unassigned.map((u) => (
                <div key={u.userId} className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-3 text-sm">
                  <span className="font-medium text-ink">{u.email}</span>
                  <input
                    value={assignName[u.userId] ?? ""}
                    onChange={(e) => setAssignName((prev) => ({ ...prev, [u.userId]: e.target.value }))}
                    placeholder="Tên hiển thị"
                    className={`${inputCls} w-48 px-2 py-1.5`}
                  />
                  <select
                    value={assignRole[u.userId] ?? "staff"}
                    onChange={(e) => setAssignRole((prev) => ({ ...prev, [u.userId]: e.target.value }))}
                    className={`${inputCls} px-2 py-1.5`}
                  >
                    {ROLES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() =>
                      patchUser(u.userId, {
                        action: "assign",
                        role: assignRole[u.userId] ?? "staff",
                        displayName: assignName[u.userId] ?? "",
                      })
                    }
                    disabled={busy !== ""}
                    className="cb-btn-primary px-3 py-1.5 text-xs disabled:opacity-40"
                  >
                    Gán vai trò
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---------- tab Vai tro ---------- */}
      {tab === "roles" && (
        <div className="space-y-4">
          <div className="cb-card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
              <h2 className="text-base font-bold text-ink">4 vai trò</h2>
              <button onClick={() => setCompareRoles((v) => !v)} className="cb-btn-ghost px-3 py-1.5 text-sm">
                {compareRoles ? "Ẩn bảng so sánh" : "So sánh các vai trò"}
              </button>
            </div>
            {ROLES.map((r) => {
              const count = users.filter((u) => u.role === r.value).length;
              return (
                <div
                  key={r.value}
                  className="flex flex-wrap items-center gap-3 border-b border-[var(--nui-bg)] px-5 py-3 last:border-b-0"
                >
                  <span className="w-36 font-semibold text-ink">{r.label}</span>
                  <span className="flex-1 text-sm text-muted">{ROLE_PROMISE[r.value]}</span>
                  <span className="text-sm text-muted">
                    {setupNeeded ? "—" : `${count} người dùng`}
                  </span>
                </div>
              );
            })}
            {compareRoles && (
              <div className="overflow-x-auto px-5 py-3">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-muted">
                      <th className="py-2 pr-3 font-semibold">Quyền</th>
                      {ROLES.map((r) => (
                        <th key={r.value} className="px-3 py-2 text-center font-semibold">
                          {r.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {MATRIX.map((row) => (
                      <tr key={row.label} className="border-b border-[var(--nui-bg)]">
                        <td className="py-2 pr-3">{row.label}</td>
                        {ROLES.map((r) => (
                          <td key={r.value} className="px-3 py-2 text-center">
                            {row.caps[r.value] ? (
                              <span className="font-bold text-success">✓</span>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-muted">
                  Bảng này chỉ để xem — sửa quyền của 1 vai trò chưa làm ở đây (chờ bảng phân quyền của sếp).
                </p>
              </div>
            )}
          </div>
          <div className="rounded-xl bg-[var(--nui-bg)] p-4 text-sm text-muted">
            <b className="text-ink">Bảng này là quyền THỰC TẾ hôm nay.</b> Quản lý tòa và Buồng phòng hiện dùng
            chung mức Lễ tân vì bảng phân quyền chi tiết chưa chốt với sếp. Khi sếp chốt (ai được xem giá, ai được khóa phòng, ai
            được xem báo cáo...), chỉ cần sửa chỗ nhận quyền, không cần làm lại trang này — lúc đó cột Quản lý tòa / Buồng phòng
            sẽ đổi theo bảng mới.
          </div>
        </div>
      )}
    </div>
  );
}
