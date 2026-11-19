// ============================================================
// API ROUTE — app/api/admin/users/route.ts (USERS3)
// Quan ly nguoi dung (chi Admin): liet ke, tao tai khoan, doi
// vai tro, khoa/mo khoa, dat lai mat khau, luu khoa service.
//
// TAO TAI KHOAN KHONG LAM DUOC TU TRINH DUYET: supabase.auth
// .signUp() se dang xuat admin hien tai va dang nhap bang tai
// khoan moi. Nen phai di qua route nay (chay phia may chu) voi
// khoa service_role — khoa nay BYPASS moi RLS.
//
// USERS3 — KHOA LAY TU 2 NOI (uu tien theo thu tu):
//   1. Bien moi truong SUPABASE_SERVICE_ROLE_KEY trong .env.local
//      (cach chuan; them xong khoi dong lai dev server).
//   2. Bang admin_secrets (SQL 21) — anh DAN KHOA NGAY TREN TRANG
//      Nguoi dung (muc Cai dat khoa), dung duoc ngay, khong can
//      khoi dong lai. Chi Admin doc/ghi duoc bang nay (RLS).
// Neu ca 2 deu khong co, GET tra { setupNeeded: true } (200, khong
// phai 500) de trang hien the cai dat thay vi o loi do.
// ============================================================

import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

// 4 vai tro theo checklist Module 1 cua sep (GĐ1).
const ROLES = ["admin", "manager", "staff", "housekeeping"] as const;
type Role = (typeof ROLES)[number];
const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  manager: "Quản lý tòa",
  staff: "Lễ tân",
  housekeeping: "Buồng phòng",
};

function makeService(key: string): SupabaseClient {
  return createClient(URL, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Client dung token cua chinh nguoi goi (de doc ho so cua minh
// va bang admin_secrets — ca 2 deu co RLS cho phep Admin).
function getUserClient(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return { userClient: null as SupabaseClient | null, token: null as string | null };
  const userClient = createClient(URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  return { userClient, token };
}

// Nguoi goi phai la admin cua mot tai khoan nao do.
async function getCaller(userClient: SupabaseClient, token: string) {
  const { data } = await userClient.auth.getUser(token);
  if (!data.user) return null;
  const { data: profile } = await userClient
    .from("user_profiles")
    .select("account_id, role")
    .eq("user_id", data.user.id)
    .single();
  if (!profile || profile.role !== "admin") return null;
  return { userId: data.user.id, accountId: profile.account_id as string };
}

// Ket qua cua getService — khai ro kieu tra ve de TypeScript khong
// phai doan tu cac lenh return (tranh loi kieu o cac cho tra ve).
type ServiceResult =
  | { svc: SupabaseClient; keySource: "env" | "db"; needsSql: false }
  | { svc: null; keySource: null; needsSql: boolean };

// Tim khoa service_role: .env.local truoc, bang admin_secrets sau.
async function getService(userClient: SupabaseClient | null): Promise<ServiceResult> {
  if (URL && SERVICE_KEY)
    return { svc: makeService(SERVICE_KEY), keySource: "env", needsSql: false };
  if (userClient) {
    const { data, error } = await userClient
      .from("admin_secrets")
      .select("value")
      .eq("key", "service_role_key")
      .maybeSingle();
    // Ma loi 42P01 = bang admin_secrets chua co (chua chay SQL 21).
    const errCode =
      error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
    if (errCode === "42P01") return { svc: null, keySource: null, needsSql: true };
    const dbKey: string = typeof data?.value === "string" ? data.value : "";
    if (dbKey && URL) return { svc: makeService(dbKey), keySource: "db", needsSql: false };
  }
  return { svc: null, keySource: null, needsSql: false };
}

function needService() {
  return NextResponse.json(
    {
      error:
        "Chưa có khóa service_role. Cách nhanh nhất: dán khóa ngay trên trang Người dùng (mục Cài đặt khóa). Hoặc thêm dòng SUPABASE_SERVICE_ROLE_KEY=<khóa> vào .env.local rồi khởi động lại dev server. Lấy khóa ở Supabase Dashboard → Project Settings → API → service_role.",
    },
    { status: 500 },
  );
}

async function readJson(req: Request) {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// So admin con lai trong tai khoan (de chan xoa / ha vai tro admin cuoi).
async function adminCount(svc: SupabaseClient, accountId: string) {
  const { count } = await svc
    .from("user_profiles")
    .select("user_id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .eq("role", "admin");
  return count ?? 0;
}

// GET — danh sach nguoi dung cua tai khoan + tai khoan Auth chua co ho so.
// Chua co khoa thi tra setupNeeded (200) de trang hien the cai dat.
export async function GET(req: Request) {
  const { userClient, token } = getUserClient(req);
  if (!userClient || !token)
    return NextResponse.json({ error: "Bạn không có quyền quản trị." }, { status: 403 });
  const caller = await getCaller(userClient, token);
  if (!caller) return NextResponse.json({ error: "Bạn không có quyền quản trị." }, { status: 403 });

  const { svc, keySource, needsSql } = await getService(userClient);
  if (!svc)
    return NextResponse.json({ users: [], unassigned: [], setupNeeded: true, needsSql, keySource });

  const { data: profiles } = await svc
    .from("user_profiles")
    .select("user_id, role, display_name, created_at")
    .eq("account_id", caller.accountId)
    .order("created_at", { ascending: true });
  const profileList = (profiles ?? []) as {
    user_id: string;
    role: string;
    display_name: string | null;
    created_at: string;
  }[];

  // Auth users: lay 1 trang lon (du cho tai khoan PMS).
  const { data: authList, error: listErr } = await svc.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listErr) {
    // Khoa luu trong bang khong dung duoc nua (vd da doi khoa) -> bao
    // trang mo lai the cai dat de dan khoa moi.
    if (keySource === "db")
      return NextResponse.json({
        users: [],
        unassigned: [],
        setupNeeded: true,
        keyInvalid: true,
        keySource: "db",
      });
    return NextResponse.json({ error: "Không đọc được danh sách tài khoản: " + listErr.message }, { status: 500 });
  }
  const authById = new Map((authList.users ?? []).map((u) => [u.id, u]));
  const profileIds = new Set(profileList.map((p) => p.user_id));

  const users = profileList.map((p) => {
    const a = authById.get(p.user_id);
    return {
      userId: p.user_id,
      email: a?.email ?? "—",
      displayName: p.display_name ?? "",
      role: p.role as Role,
      roleLabel: ROLE_LABEL[p.role as Role] ?? p.role,
      banned: !!a?.banned_until,
      createdAt: a?.created_at ?? p.created_at,
      lastSignInAt: a?.last_sign_in_at ?? null,
    };
  });
  // Tai khoan Auth co roi nhung chua co ho so (vd tao tay o Supabase)
  // -> admin gan vai tro cho ho ngay tren trang.
  const unassigned = (authList.users ?? [])
    .filter((u) => !profileIds.has(u.id))
    .map((u) => ({ userId: u.id, email: u.email ?? "—", createdAt: u.created_at }));

  return NextResponse.json({ users, unassigned, setupNeeded: false, keySource });
}

// POST — luu khoa service_role (action saveKey) HOAC tao tai khoan
// moi (Auth + ho so).
export async function POST(req: Request) {
  const { userClient, token } = getUserClient(req);
  if (!userClient || !token)
    return NextResponse.json({ error: "Bạn không có quyền quản trị." }, { status: 403 });
  const caller = await getCaller(userClient, token);
  if (!caller) return NextResponse.json({ error: "Bạn không có quyền quản trị." }, { status: 403 });

  const body = await readJson(req);

  // --- Luu khoa service_role vao bang admin_secrets (USERS3) ---
  // Thu khoa that bang cach goi Auth Admin truoc khi luu: khoa sai
  // thi bao ngay, khong luu khoa hong vao bang.
  if (String(body.action ?? "") === "saveKey") {
    const key = String(body.key ?? "").trim();
    if (!key.startsWith("eyJ") || key.length < 50)
      return NextResponse.json(
        { error: "Khóa này không giống khóa service_role (thường bắt đầu bằng eyJ và rất dài). Kiểm tra xem anh có copy nhầm khóa anon không." },
        { status: 400 },
      );
    const trial = makeService(key);
    const { error: testErr } = await trial.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (testErr)
      return NextResponse.json(
        { error: "Khóa này không dùng được (" + testErr.message + "). Kiểm tra lại khóa service_role đã copy." },
        { status: 400 },
      );
    const { error: saveErr } = await userClient.from("admin_secrets").upsert({
      key: "service_role_key",
      value: key,
      updated_at: new Date().toISOString(),
    });
    if (saveErr)
      return NextResponse.json(
        { error: "Không lưu được khóa: " + saveErr.message + " — anh đã chạy file SQL 21-admin-secrets.sql chưa?" },
        { status: 500 },
      );
    return NextResponse.json({ ok: true, keySource: "db" });
  }

  const { svc } = await getService(userClient);
  if (!svc) return needService();

  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const displayName = String(body.displayName ?? "").trim();
  const role = String(body.role ?? "staff");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return NextResponse.json({ error: "Email chưa đúng định dạng." }, { status: 400 });
  if (password.length < 6)
    return NextResponse.json({ error: "Mật khẩu phải từ 6 ký tự trở lên." }, { status: 400 });
  if (!displayName)
    return NextResponse.json({ error: "Chưa nhập tên hiển thị." }, { status: 400 });
  if (!(ROLES as readonly string[]).includes(role))
    return NextResponse.json({ error: "Vai trò không hợp lệ." }, { status: 400 });

  const { data, error } = await svc.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });
  if (error || !data.user)
    return NextResponse.json({ error: "Không tạo được tài khoản: " + (error?.message ?? "lỗi không rõ") }, { status: 400 });

  const { error: profErr } = await svc.from("user_profiles").insert({
    user_id: data.user.id,
    account_id: caller.accountId,
    role,
    display_name: displayName,
  });
  if (profErr) {
    // Tai khoan Auth da co, chi thieu ho so — admin gan vai tro sau
    // o muc "Tài khoản chưa có hồ sơ".
    return NextResponse.json(
      {
        error:
          "Tài khoản đã tạo nhưng chưa gắn hồ sơ (vai trò): " +
          profErr.message +
          " — vào mục “Tài khoản chưa có hồ sơ” để gán vai trò.",
      },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, userId: data.user.id });
}

// PATCH — doi vai tro / khoa / mo khoa / dat lai mat khau / gan ho so.
export async function PATCH(req: Request) {
  const { userClient, token } = getUserClient(req);
  if (!userClient || !token)
    return NextResponse.json({ error: "Bạn không có quyền quản trị." }, { status: 403 });
  const caller = await getCaller(userClient, token);
  if (!caller) return NextResponse.json({ error: "Bạn không có quyền quản trị." }, { status: 403 });

  const { svc } = await getService(userClient);
  if (!svc) return needService();

  const body = await readJson(req);
  const userId = String(body.userId ?? "");
  const action = String(body.action ?? "");
  if (!userId) return NextResponse.json({ error: "Thiếu userId." }, { status: 400 });

  // Muc tieu phai thuoc cung tai khoan (tru tac vu 'assign' danh cho
  // tai khoan chua co ho so o bat ky dau).
  const { data: target } = await svc
    .from("user_profiles")
    .select("account_id, role")
    .eq("user_id", userId)
    .maybeSingle();

  if (action === "assign") {
    if (target) return NextResponse.json({ error: "Tài khoản này đã có hồ sơ rồi." }, { status: 400 });
    const role = String(body.role ?? "staff");
    const displayName = String(body.displayName ?? "").trim();
    if (!(ROLES as readonly string[]).includes(role))
      return NextResponse.json({ error: "Vai trò không hợp lệ." }, { status: 400 });
    if (!displayName) return NextResponse.json({ error: "Chưa nhập tên hiển thị." }, { status: 400 });
    const { error } = await svc.from("user_profiles").insert({
      user_id: userId,
      account_id: caller.accountId,
      role,
      display_name: displayName,
    });
    if (error) return NextResponse.json({ error: "Không gắn được hồ sơ: " + error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (!target || target.account_id !== caller.accountId)
    return NextResponse.json({ error: "Tài khoản này không thuộc tài khoản của bạn." }, { status: 403 });

  if (action === "role") {
    const role = String(body.role ?? "");
    if (!(ROLES as readonly string[]).includes(role))
      return NextResponse.json({ error: "Vai trò không hợp lệ." }, { status: 400 });
    if (userId === caller.userId && role !== "admin")
      return NextResponse.json({ error: "Không tự hạ vai trò của chính mình — nhờ một admin khác làm." }, { status: 400 });
    if (target.role === "admin" && role !== "admin" && (await adminCount(svc, caller.accountId)) <= 1)
      return NextResponse.json(
        { error: "Đây là admin duy nhất của tài khoản — tạo thêm một admin khác trước rồi mới hạ vai trò người này." },
        { status: 400 },
      );
    const { error } = await svc.from("user_profiles").update({ role }).eq("user_id", userId);
    if (error) return NextResponse.json({ error: "Không đổi được vai trò: " + error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === "displayName") {
    const displayName = String(body.displayName ?? "").trim();
    if (!displayName) return NextResponse.json({ error: "Tên hiển thị không được để trống." }, { status: 400 });
    const { error } = await svc.from("user_profiles").update({ display_name: displayName }).eq("user_id", userId);
    if (error) return NextResponse.json({ error: "Không đổi được tên: " + error.message }, { status: 500 });
    // Dong bo ten hien thi vao ho so Auth de Supabase Dashboard thay dung.
    await svc.auth.admin.updateUserById(userId, { user_metadata: { display_name: displayName } });
    return NextResponse.json({ ok: true });
  }

  if (action === "lock" || action === "unlock") {
    if (userId === caller.userId)
      return NextResponse.json({ error: "Không tự khóa chính mình." }, { status: 400 });
    const { error } = await svc.auth.admin.updateUserById(userId, {
      ban_duration: action === "lock" ? "87600h" : "none",
    });
    if (error) return NextResponse.json({ error: "Không đổi được trạng thái khóa: " + error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === "password") {
    const password = String(body.password ?? "");
    if (password.length < 6)
      return NextResponse.json({ error: "Mật khẩu phải từ 6 ký tự trở lên." }, { status: 400 });
    const { error } = await svc.auth.admin.updateUserById(userId, { password });
    if (error) return NextResponse.json({ error: "Không đổi được mật khẩu: " + error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Hành động không hợp lệ." }, { status: 400 });
}

// DELETE — xoa han tai khoan (Auth + ho so tu xoa theo ON DELETE
// CASCADE). Chan: tu xoa chinh minh; xoa admin duy nhat.
export async function DELETE(req: Request) {
  const { userClient, token } = getUserClient(req);
  if (!userClient || !token)
    return NextResponse.json({ error: "Bạn không có quyền quản trị." }, { status: 403 });
  const caller = await getCaller(userClient, token);
  if (!caller) return NextResponse.json({ error: "Bạn không có quyền quản trị." }, { status: 403 });

  const { svc } = await getService(userClient);
  if (!svc) return needService();

  const body = await readJson(req);
  const userId = String(body.userId ?? "");
  if (!userId) return NextResponse.json({ error: "Thiếu userId." }, { status: 400 });
  if (userId === caller.userId)
    return NextResponse.json({ error: "Không tự xóa chính mình." }, { status: 400 });

  const { data: target } = await svc
    .from("user_profiles")
    .select("account_id, role")
    .eq("user_id", userId)
    .maybeSingle();
  if (!target || target.account_id !== caller.accountId)
    return NextResponse.json({ error: "Tài khoản này không thuộc tài khoản của bạn." }, { status: 403 });
  if (target.role === "admin" && (await adminCount(svc, caller.accountId)) <= 1)
    return NextResponse.json(
      { error: "Đây là admin duy nhất của tài khoản — tạo thêm một admin khác trước rồi mới xóa người này." },
      { status: 400 },
    );

  const { error } = await svc.auth.admin.deleteUser(userId);
  if (error) return NextResponse.json({ error: "Không xóa được tài khoản: " + error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
