"use client";
// ============================================================
// app/[hotelId]/settings/users/page.tsx — Quan ly nguoi dung
// (chi Admin). Tao tai khoan, gan vai tro, khoa/mo khoa, dat lai
// mat khau. Moi tac vu di qua /api/admin/users (chay phia may
// chu, khoa service_role) — trinh duyet khong tu tao duoc tai
// khoan Auth (signUp se dang xuat admin hien tai).
//
// 4 vai tro theo checklist Module 1 cua sep:
//   Admin — toan quyen. | Quan ly toa — quan ly toa nha.
//   Le tan — truc quay. | Buong phong — don phong.
// QUYEN THUC TE HIEN TAI: chi Admin moi co quyen admin; 3 vai
// tro con lai deu dung muc Le tan (staff) cho den khi sep chot
// bang phan quyen chi tiet — khi do chi sua cho nhan quyen o
// lib/current-role.ts + layout, khong doi trang nay.
// ============================================================

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { IconBan, IconCheckCircle, IconEdit, IconPlus, IconUser } from "@/components/icons";

const inputCls =
  "rounded-lg border border-[var(--cb-border)] px-3 py-2 text-sm text-[var(--cb-text)] outline-none focus:border-[var(--cb-blue)]";

const ROLES = [
  { value: "admin", label: "Admin" },
  { value: "manager", label: "Quản lý tòa" },
  { value: "staff", label: "Lễ tân" },
  { value: "housekeeping", label: "Buồng phòng" },
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
  const [users, setUsers] = useState<UserRow[]>([]);
  const [unassigned, setUnassigned] = useState<UnassignedRow[]>([]);
  const [me, setMe] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [setupError, setSetupError] = useState("");
  const [busy, setBusy] = useState("");

  // Form tao tai khoan moi.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState("staff");
  const [creating, setCreating] = useState(false);

  // Doi mat khau cho 1 nguoi (mo form inline o dung dong do).
  const [resetId, setResetId] = useState("");
  const [newPassword, setNewPassword] = useState("");

  // Gan vai tro cho tai khoan chua co ho so.
  const [assignName, setAssignName] = useState<Record<string, string>>({});
  const [assignRole, setAssignRole] = useState<Record<string, string>>({});

  async function load() {
    setError("");
    setSetupError("");
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setMe(user?.id ?? "");
      const json = await api("/api/admin/users");
      setUsers(json.users ?? []);
      setUnassigned(json.unassigned ?? []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Không tải được danh sách.";
      if (msg.includes("SUPABASE_SERVICE_ROLE_KEY")) setSetupError(msg);
      else setError(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  return (
    <div className="space-y-4">
      <div>
        <Link href={`/${hotelId}/settings`} className="text-sm font-medium text-[var(--cb-blue)] hover:underline">
          ← Về Cài đặt
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-[var(--cb-text)]">Người dùng</h1>
        <p className="text-sm text-[var(--cb-muted)]">
          Tạo tài khoản, gán vai trò, khóa/mở khóa và đặt lại mật khẩu cho nhân viên. Chỉ Admin thấy trang này.
        </p>
      </div>

      {setupError && (
        <div className="rounded-xl border border-[#f5c6c6] bg-[#fdecec] p-4 text-sm text-[#7a1f1f]">
          <b>Chưa bật được quản lý người dùng.</b>
          <p className="mt-1">{setupError}</p>
          <p className="mt-2">
            Cách làm: vào Supabase Dashboard → Project Settings → API → copy khóa <b>service_role</b>, thêm 1 dòng vào file{" "}
            <code>.env.local</code> rồi khởi động lại dev server (Ctrl+C rồi <code>npm run dev</code>). Không dán khóa này vào chat
            và không để nó vào biến NEXT_PUBLIC_*.
          </p>
        </div>
      )}
      {error && <p className="rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#e5484d]">{error}</p>}

      {/* ---------- tao tai khoan moi ---------- */}
      <div className="cb-card space-y-3 p-5">
        <h2 className="flex items-center gap-2 text-base font-bold text-[var(--cb-text)]">
          <IconPlus className="h-5 w-5" /> Thêm người dùng mới
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-[var(--cb-text)]">
            Email *
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="VD: letan2@pms.local" className={`${inputCls} mt-1 block w-full`} />
          </label>
          <label className="text-sm text-[var(--cb-text)]">
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
          <label className="text-sm text-[var(--cb-text)]">
            Tên hiển thị *
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="VD: Lễ tân Ca tối" className={`${inputCls} mt-1 block w-full`} />
          </label>
          <label className="text-sm text-[var(--cb-text)]">
            Vai trò
            <select value={role} onChange={(e) => setRole(e.target.value)} className={`${inputCls} mt-1 block w-full`}>
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-xs text-[var(--cb-muted)]">
          Tài khoản tạo xong đăng nhập được ngay, không cần xác nhận email. Ghi mật khẩu ra giấy cho nhân viên — mật khẩu không
          gửi qua email và không xem lại được sau này.
        </p>
        <button onClick={createUser} disabled={creating} className="cb-btn-primary px-5 py-2.5 text-sm disabled:opacity-50">
          {creating ? "Đang tạo..." : "Tạo tài khoản"}
        </button>
      </div>

      {/* ---------- danh sach ---------- */}
      <div className="cb-card overflow-hidden">
        <div className="border-b border-[var(--cb-border)] px-5 py-3">
          <h2 className="text-base font-bold text-[var(--cb-text)]">Tài khoản trong hệ thống ({users.length})</h2>
        </div>
        {loading ? (
          <p className="p-5 text-sm text-[var(--cb-muted)]">Đang tải danh sách...</p>
        ) : users.length === 0 ? (
          <p className="p-5 text-sm text-[var(--cb-muted)]">Chưa có tài khoản nào.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--cb-border)] text-left text-xs text-[var(--cb-muted)]">
                <th className="px-5 py-2.5 font-semibold">Người dùng</th>
                <th className="px-3 py-2.5 font-semibold">Vai trò</th>
                <th className="px-3 py-2.5 font-semibold">Trạng thái</th>
                <th className="px-3 py-2.5 font-semibold">Đăng nhập gần nhất</th>
                <th className="px-3 py-2.5 font-semibold">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.userId} className="border-b border-[var(--cb-bg)] align-top">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--cb-blue-soft)] text-[var(--cb-blue)]">
                        <IconUser className="h-5 w-5" />
                      </span>
                      <span>
                        <span className="block font-semibold text-[var(--cb-text)]">
                          {u.displayName || "(chưa đặt tên)"}
                          {u.userId === me && <span className="ml-2 rounded bg-[var(--cb-bg)] px-2 py-0.5 text-xs text-[var(--cb-muted)]">bạn</span>}
                        </span>
                        <span className="block text-xs text-[var(--cb-muted)]">{u.email}</span>
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <select
                      value={u.role}
                      disabled={u.userId === me || busy !== ""}
                      onChange={(e) => patchUser(u.userId, { action: "role", role: e.target.value })}
                      className={`${inputCls} px-2 py-1.5`}
                      title={u.userId === me ? "Không tự đổi vai trò của chính mình" : "Đổi vai trò"}
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
                      <span className="rounded-full bg-[#fdecec] px-2.5 py-1 text-xs font-medium text-[#e5484d]">Đã khóa</span>
                    ) : (
                      <span className="rounded-full bg-[#e6f7f1] px-2.5 py-1 text-xs font-medium text-[#0e7a56]">Hoạt động</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-[var(--cb-muted)]">{fmtDateTime(u.lastSignInAt)}</td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-2">
                      {u.banned ? (
                        <button
                          onClick={() => patchUser(u.userId, { action: "unlock" }, `Mở khóa tài khoản ${u.email}?`)}
                          disabled={busy !== "" || u.userId === me}
                          className="cb-btn-ghost flex items-center gap-1 px-3 py-1.5 text-xs disabled:opacity-40"
                        >
                          <IconCheckCircle className="h-4 w-4" /> Mở khóa
                        </button>
                      ) : (
                        <button
                          onClick={() => patchUser(u.userId, { action: "lock" }, `Khóa tài khoản ${u.email}? Người này sẽ không đăng nhập được nữa.`)}
                          disabled={busy !== "" || u.userId === me}
                          className="cb-btn-ghost flex items-center gap-1 px-3 py-1.5 text-xs text-[#e5484d] disabled:opacity-40"
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
          <h2 className="text-base font-bold text-[var(--cb-text)]">Tài khoản chưa có hồ sơ ({unassigned.length})</h2>
          <p className="text-sm text-[var(--cb-muted)]">
            Các tài khoản này đã có trong Supabase Auth nhưng chưa gắn vai trò — họ chưa đăng nhập được đúng quyền. Gán vai trò
            cho họ ở đây.
          </p>
          {unassigned.map((u) => (
            <div key={u.userId} className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--cb-border)] p-3 text-sm">
              <span className="font-medium text-[var(--cb-text)]">{u.email}</span>
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

      <div className="rounded-xl bg-[var(--cb-bg)] p-4 text-sm text-[var(--cb-muted)]">
        <b className="text-[var(--cb-text)]">Về 4 vai trò:</b> Admin có toàn quyền. Quản lý tòa, Lễ tân và Buồng phòng hiện
        tại đều dùng chung mức quyền Lễ tân (xem lịch phòng, đặt phòng, check-in/out; không thấy giá kênh và cài đặt hệ thống) —
        vì bảng phân quyền chi tiết chưa chốt với sếp. Khi sếp chốt (ai được xem giá, ai được khóa phòng, ai được xem báo cáo...),
        chỉ cần sửa chỗ nhận quyền, không cần làm lại trang này.
      </div>
    </div>
  );
}
