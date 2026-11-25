"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

// Boc noi dung trang: moi lan doi duong dan thi ve lai tu dau voi hieu
// ung mo dan + truot nhe len (0,28 giay). Thanh tren + menu day dung
// yen, chi phan noi dung chinh chay hieu ung. Hieu ung that nam o
// lop .page-enter trong app/globals.css.
export default function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="page-enter">
      {children}
    </div>
  );
}
