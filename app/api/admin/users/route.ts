// ============================================================
// API ROUTE — app/api/admin/users/route.ts
// Quan ly nguoi dung (chi Admin): liet ke, tao tai khoan, doi
// vai tro, khoa/mo khoa, dat lai mat khau.
//
// TAO TAI KHOAN KHONG LAM DUOC TU TRINH DUYET: supabase.auth
// .signUp() se dang xuat admin hien tai va dang nhap bang tai
// khoan moi. Nen phai di qua route nay (chay phia may chu) voi
// khoa service_role — khoa nay BYPASS moi RLS nen CHI doc tu
// bien moi truong SUPABASE_SERVICE_ROLE_KEY (khong NEXT_PUBLIC,
// khong commit, khong gui qua chat). Them vao .env.local:
//   SUPABASE_SERVICE_ROLE_KEY=<khoa service_role>
// Lay o Supabase Dashboard -> Project Settings -> API ->
// service_role. Them xong khoi dong lai dev server.
//
// Xac thuc: trinh duyet gui access token cua admin trong header
// Authorization: Bearer <token>. Route kiem tra token (auth.
// getUser) roi doc user_profiles — chi role = 'admin' moi duoc
// goi. Muc tieu (doi vai tro / khoa / doi mat khau) phai thuoc
// cung tai khoan (account) voi admin goi. Khong cho admin tu
// ha vai tro / tu khoa chinh minh.
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

function serviceClient(): SupabaseClient | null {
  if (!URL || !SERVICE_KEY) return null;
  return createClient(URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function needService() {
  return NextResponse.json(
    {
      error:
        "Chưa cấu hình SUPABASE_SERVICE_ROLE_KEY trong .env.local. Lấy khóa service_role ở Supabase Dashboard → Project Settings → API, thêm dòng SUPABASE_SERVICE_ROLE_KEY=<khóa> vào .env.local rồi khởi động lại dev server. Không dùng khóa này ở phía trình duyệt.",
    },
    { status: 500 },
  );
}

// Nguoi goi phai la admin cua mot tai khoan nao do.
async function getCaller(req: Request, svc: SupabaseClient) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const userClient = createClient(URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data } = await userClient.auth.getUser(token);
  if (!data.user) return null;
  const { data: profile } = await svc
    .from("user_profiles")
    .select("account_id, role")
    .eq("user_id", data.user.id)
    .single();
  if (!profile || profile.role !== "admin") return null;
  return { userId: data.user.id, accountId: profile.account_id as string };
}

async function readJson(req: Request) {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// GET — danh sach nguoi dung cua tai khoan + tai khoan Auth chua co ho so.
export async function GET(req: Request) {
  const svc = serviceClient();
  if (!svc) return needService();
  const caller = await getCaller(req, svc);
  if (!caller) return NextResponse.json({ error: "Bạn không có quyền quản trị." }, { status: 403 });

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
  if (listErr) return NextResponse.json({ error: "Không đọc được danh sách tài khoản: " + listErr.message }, { status: 500 });
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

  return NextResponse.json({ users, unassigned });
}

// POST — tao tai khoan moi (Auth + ho so).
export async function POST(req: Request) {
  const svc = serviceClient();
  if (!svc) return needService();
  const caller = await getCaller(req, svc);
  if (!caller) return NextResponse.json({ error: "Bạn không có quyền quản trị." }, { status: 403 });

  const body = await readJson(req);
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
  const svc = serviceClient();
  if (!svc) return needService();
  const caller = await getCaller(req, svc);
  if (!caller) return NextResponse.json({ error: "Bạn không có quyền quản trị." }, { status: 403 });

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
    const { error } = await svc.from("user_profiles").update({ role }).eq("user_id", userId);
    if (error) return NextResponse.json({ error: "Không đổi được vai trò: " + error.message }, { status: 500 });
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
