import { requireUser } from "@/lib/session";
import { listUserDirectory } from "@/server/access.service";
import { listImages } from "@/server/image.service";
import { ExchangeTabs } from "@/components/image-exchange";

// 交换图片：顶部「申请查看 / 图片访问」两个按钮切换——浏览与申请 或 审批与授权管理
export default async function UsersDirectoryPage() {
  const user = await requireUser();
  const users = await listUserDirectory(user);
  // 服务端预取第一个可查看用户的首屏，切换其他人时客户端按需拉取
  const first = users.find((u) => u.relation === "canViewThem");
  const firstPage = first
    ? await listImages({ viewer: user, scope: "user", username: first.name })
    : { items: [], nextCursor: null };

  return (
    <ExchangeTabs
      users={users}
      initialUser={first ?? null}
      initialItems={firstPage.items}
      initialCursor={firstPage.nextCursor}
    />
  );
}
