import { ConsoleShell } from "@/components/console-shell";

// 登录区通用外壳：所有控制台页面（画廊/图片/相册/回收站/个人中心/后台）共用
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return <ConsoleShell>{children}</ConsoleShell>;
}
