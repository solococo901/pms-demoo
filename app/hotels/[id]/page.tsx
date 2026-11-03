import { redirect } from "next/navigation";

// Duong dan cu /hotels/[id] — tu chuyen sang khu lam viec moi
// /<ten-khach-san>/hotel-info (trang thiet lap thong tin khach san).
export default async function HotelDetailRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/${id}/hotel-info`);
}
