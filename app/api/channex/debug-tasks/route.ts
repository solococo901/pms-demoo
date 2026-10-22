// ============================================================
// API ROUTE — app/api/channex/debug-tasks/route.ts
// Cong cu TAM THOI cho buoc nop form kiem dinh: liet ke tasks
// cua "Test Property" (keo het cac trang) de doi chieu tung
// bai test. Xoa sau khi nop form.
// ============================================================

import { NextResponse } from "next/server";

type CxTask = {
  id: string;
  title?: string;
  type?: string;
  attributes?: Record<string, unknown>;
};

export async function GET() {
  const key = process.env.CHANNEX_API_KEY;
  const env = process.env.CHANNEX_ENV === "production" ? "production" : "staging";
  if (!key) {
    return NextResponse.json({ ok: false, error: "Chưa có CHANNEX_API_KEY trong .env.local." });
  }
  const base =
    env === "production" ? "https://app.channex.io" : "https://staging.channex.io";
  const headers = { "user-api-key": key };

  try {
    const propRes = await fetch(`${base}/api/v1/properties`, { headers, cache: "no-store" });
    const propBody = await propRes.json().catch(() => null);
    if (!propRes.ok) {
      return NextResponse.json({ ok: false, error: `Đọc properties lỗi HTTP ${propRes.status}` });
    }
    const props: { id: string; attributes?: { title?: string } }[] = propBody?.data ?? [];
    const testProp = props.find((p) => (p.attributes?.title ?? "").includes("Test Property"));
    if (!testProp) {
      return NextResponse.json({ ok: false, error: "Không tìm thấy Test Property." });
    }

    const all: CxTask[] = [];
    const seen = new Set<string>();
    let meta: unknown = null;
    for (let page = 1; page <= 12; page++) {
      const res = await fetch(
        `${base}/api/v1/tasks?filter[property_id]=${testProp.id}&order[inserted_at]=desc&limit=100&page=${page}`,
        { headers, cache: "no-store" }
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        return NextResponse.json({ ok: false, error: `Đọc tasks lỗi HTTP ${res.status}`, raw: body });
      }
      if (page === 1) meta = body?.meta ?? body?.links ?? null;
      const tasks: CxTask[] = body?.data ?? [];
      let fresh = 0;
      for (const t of tasks) {
        if (!seen.has(t.id)) {
          seen.add(t.id);
          all.push(t);
          fresh++;
        }
      }
      if (tasks.length === 0 || fresh === 0) break;
    }

    const pick = (t: CxTask) => {
      const a = (t.attributes ?? {}) as Record<string, unknown>;
      const g = (k: string) => (t as unknown as Record<string, unknown>)[k] ?? a[k] ?? null;
      return {
        id: t.id,
        task: g("task"),
        success: g("success"),
        inserted_at: g("inserted_at") ?? g("created_at"),
      };
    };

    return NextResponse.json({
      ok: true,
      property: testProp.attributes?.title,
      count: all.length,
      meta,
      sample_keys: all[0]
        ? { top: Object.keys(all[0]), attributes: Object.keys(all[0].attributes ?? {}) }
        : null,
      tasks: all.slice(0, 200).map(pick),
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Không gọi được tới máy chủ Channex." });
  }
}
