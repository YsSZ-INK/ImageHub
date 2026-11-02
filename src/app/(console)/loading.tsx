// 控制台路由组通用加载骨架：任一后台页面数据加载时先出骨架屏，
// 避免白屏等待（布局/侧栏已渲染，仅内容区占位）
export default function ConsoleLoading() {
  return (
    <div className="animate-pulse space-y-4">
      {/* 标题 + 工具条占位 */}
      <div className="flex items-center justify-between gap-3">
        <div className="h-7 w-40 rounded-lg bg-foreground/10" />
        <div className="h-9 w-64 rounded-xl bg-foreground/10" />
      </div>
      {/* 卡片网格占位（与瀑布流/列表页节奏一致） */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="aspect-[4/3] rounded-xl bg-foreground/[0.07]" />
            <div className="h-3.5 w-3/4 rounded bg-foreground/10" />
          </div>
        ))}
      </div>
    </div>
  );
}
