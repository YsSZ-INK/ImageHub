import { requireAdmin } from "@/lib/session";
import { adminStats } from "@/server/admin.service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBytes, formatDate } from "@/lib/utils";

// 统计面板：核心计数 + 近 7 天上传趋势 + 存储位置分布 + 上传 Top5 + 最近注册用户
export default async function AdminPage() {
  await requireAdmin();
  const stats = await adminStats();
  const maxTrend = Math.max(...stats.trend.map((t) => t.count), 1);

  const cards = [
    { title: "用户总数", value: String(stats.userCount) },
    { title: "图片总数", value: String(stats.imageCount) },
    { title: "总存储量", value: formatBytes(stats.totalStorage) },
    { title: "今日上传", value: String(stats.todayCount) },
    { title: "待审核", value: String(stats.pendingCount) },
    { title: "回收站", value: String(stats.trashCount) },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">统计面板</h1>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => (
          <Card key={c.title}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{c.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">近 7 天上传趋势</CardTitle>
        </CardHeader>
        <CardContent>
          {/* 柱高用像素而非百分比：父列高度不定时 % 会解析为 0 导致柱子不可见 */}
          <div className="flex h-40 items-end gap-3">
            {stats.trend.map((t) => {
              const barH = Math.max(Math.round((t.count / maxTrend) * 108), 4);
              return (
                <div key={t.date} className="flex flex-1 flex-col items-center justify-end gap-1.5 self-stretch">
                  <span className="text-xs text-muted-foreground">{t.count}</span>
                  <div
                    className={`w-full max-w-12 rounded-t ${t.count > 0 ? "bg-primary/80" : "bg-muted"}`}
                    style={{ height: `${barH}px` }}
                  />
                  <span className="text-xs text-muted-foreground">{t.date}</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-3">
        {/* 存储位置分布：各位置图片数与占用，标签与侧栏/筛选一致 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">存储位置分布</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {stats.storageBreakdown.length === 0 ? (
              <p className="text-sm text-muted-foreground">还没有图片</p>
            ) : (
              stats.storageBreakdown.map((b) => (
                <div key={b.marker} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{b.label}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {b.count} 张 · {formatBytes(b.size)}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* 上传 Top5：按未删除图片数排名 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">上传排行（前 5）</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {stats.topUploaders.length === 0 ? (
              <p className="text-sm text-muted-foreground">还没有上传记录</p>
            ) : (
              stats.topUploaders.map((u, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="w-5 shrink-0 text-center font-medium text-muted-foreground">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{u.name}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {u.count} 张 · {formatBytes(u.size)}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* 最近注册用户：最新 5 个账号 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">最近注册用户</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {stats.recentUsers.length === 0 ? (
              <p className="text-sm text-muted-foreground">还没有用户</p>
            ) : (
              stats.recentUsers.map((u) => (
                <div key={u.email} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">
                    {u.name}
                    {u.role === "ADMIN" && (
                      <span className="ml-1.5 rounded bg-primary/10 px-1 py-0.5 text-[0.625rem] text-primary">管理员</span>
                    )}
                    <span className="ml-1.5 text-xs text-muted-foreground">{u.email}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatDate(u.createdAt)}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
