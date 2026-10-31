import { requireAdmin } from "@/lib/session";
import { adminStats } from "@/server/admin.service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBytes } from "@/lib/utils";

// 统计面板：用户数、图片数、总存储、近 7 天上传趋势
export default async function AdminPage() {
  await requireAdmin();
  const stats = await adminStats();
  const maxTrend = Math.max(...stats.trend.map((t) => t.count), 1);

  const cards = [
    { title: "用户总数", value: String(stats.userCount) },
    { title: "图片总数", value: String(stats.imageCount) },
    { title: "总存储量", value: formatBytes(stats.totalStorage) },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">统计面板</h1>

      <div className="grid gap-3 sm:grid-cols-3">
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
    </div>
  );
}
