import { requireUser } from "@/lib/session";
import { listUserDirectory } from "@/server/access.service";
import { listImages } from "@/server/image.service";
import { ExchangeView } from "@/components/image-exchange";
import { AccessPanel } from "@/components/access-panel";

// 交换图片：已授权用户页内切换浏览其图片；未授权的在下方目录发起申请；底部「图片访问」面板审批/撤销授权
export default async function UsersDirectoryPage() {
  const user = await requireUser();
  const users = await listUserDirectory(user);
  // 服务端预取第一个可查看用户的首屏，切换其他人时客户端按需拉取
  const first = users.find((u) => u.relation === "canViewThem");
  const firstPage = first
    ? await listImages({ viewer: user, scope: "user", username: first.name })
    : { items: [], nextCursor: null };

  return (
    <div className="space-y-6">
      <ExchangeView
        users={users}
        initialUser={first ?? null}
        initialItems={firstPage.items}
        initialCursor={firstPage.nextCursor}
      />
      <div id="access-panel">
        <AccessPanel />
      </div>
    </div>
  );
}
