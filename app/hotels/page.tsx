import { redirect } from "next/navigation";

// Duong dan cu /hotels -> chuyen ve trang danh sach moi o /.
// (Trang danh sach da chuyen ve domain /, con /hotels/[id] van giu nguyen.)
export default function HotelsRedirect() {
  redirect("/");
}
