"use client";

import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/password-input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import Link from "next/link";

// 首页登录/注册表单
export function AuthForm({ allowRegister }: { allowRegister: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  // callbackUrl 仅接受站内相对路径：挡掉 //evil.com、/\evil.com 这类
  // 被浏览器视为协议相对地址的外站跳转（开放重定向钓鱼）
  const rawCallback = params.get("callbackUrl");
  const callbackUrl =
    rawCallback && rawCallback.startsWith("/") && !rawCallback.startsWith("//") && !rawCallback.startsWith("/\\")
      ? rawCallback
      : "/gallery";

  const [loginData, setLoginData] = useState({ email: "", password: "", remember: false });
  const [regData, setRegData] = useState({ email: "", name: "", password: "" });
  const [loading, setLoading] = useState(false);

  // 登录成功后进入控制台：
  // 优先软导航——布局与骨架屏（app/(console)/loading.tsx）立即可见，数据在骨架里补齐，
  // 不用等整页 HTML 渲染完才「进去」。
  // 3.5 秒后若仍停在登录页（软导航被中间件按旧状态弹回等极端情况），兜底整页跳转。
  // 用 replace 而不是 push：登录页不留在历史里，否则手机按返回键会退回登录页（bfcache 直接还原旧页面）。
  function enterConsole() {
    const from = window.location.pathname;
    router.replace(callbackUrl);
    window.setTimeout(() => {
      if (window.location.pathname === from) window.location.replace(callbackUrl);
    }, 3500);
  }

  // 兼容修复前已经登录、历史里仍留着登录页的用户：
  // 从 bfcache 恢复（persisted=true）时，凭当前会话直接跳进控制台，不再显示登录表单
  useEffect(() => {
    function onPageShow(e: PageTransitionEvent) {
      if (e.persisted) window.location.replace(callbackUrl);
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [callbackUrl]);

  async function doLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await signIn("credentials", {
        email: loginData.email,
        password: loginData.password,
        remember: String(loginData.remember),
        redirect: false,
      });
      if (res?.error) {
        // 按服务端 LoginBlockedError 携带的 code 区分文案（限流 / 封禁 / 其余视为凭据错误）
        if (res.code === "rate_limited") toast.error("登录尝试过于频繁，请稍后再试");
        else if (res.code === "banned") toast.error("账号已被封禁，请联系管理员");
        else if (res.code === "CALLBACK_ERROR") toast.error("登录失败");
        else toast.error("邮箱或密码错误");
      } else {
        // signIn 成功 ≠ 会话一定落盘：反向代理吞掉 Set-Cookie、浏览器禁用 Cookie、
        // 访问域名与 AUTH_URL 不一致时，跳转会被中间件弹回登录页，用户只看到「点了没反应」。
        // 先确认会话真的生效，再跳转；没生效就给出明确原因。
        const session: { user?: unknown } | null | undefined = await fetch("/api/auth/session", { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => undefined);
        if (session && !session.user) {
          toast.error("登录已通过，但会话没有保存：请检查浏览器是否禁用了 Cookie，或反向代理是否拦截了 Set-Cookie");
          return;
        }
        enterConsole();
      }
    } catch {
      // 网络中断 / 反向代理 502 / 移动端切换网络时 fetch 抛错：
      // 必须给出可见反馈，否则用户只会看到按钮转一下就复原，像是「点了没反应」
      toast.error("网络异常，登录请求未完成，请检查网络后重试");
    } finally {
      setLoading(false);
    }
  }

  async function doRegister(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(regData),
      });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json.error || "注册失败");
        return;
      }
      toast.success("注册成功，验证邮件已发送（开发环境查看控制台），正在自动登录…");
      const login = await signIn("credentials", {
        email: regData.email,
        password: regData.password,
        remember: "false",
        redirect: false,
      });
      if (!login?.error) {
        enterConsole();
      }
    } catch {
      // 注册接口或随后的自动登录请求抛错时同样要有可见反馈
      toast.error("网络异常，注册请求未完成，请检查网络后重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Tabs defaultValue="login">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="login">登录</TabsTrigger>
        <TabsTrigger value="register" disabled={!allowRegister}>
          注册
        </TabsTrigger>
      </TabsList>

      <TabsContent value="login">
        <form onSubmit={doLogin} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">邮箱</Label>
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={loginData.email}
              onChange={(e) => setLoginData({ ...loginData, email: e.target.value })}
              placeholder="you@example.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">密码</Label>
            <PasswordInput
              id="password"
              required
              autoComplete="current-password"
              value={loginData.password}
              onChange={(e) => setLoginData({ ...loginData, password: e.target.value })}
              placeholder="请输入密码"
            />
          </div>
          <div className="flex items-center justify-between text-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="accent-current"
                checked={loginData.remember}
                onChange={(e) => setLoginData({ ...loginData, remember: e.target.checked })}
              />
              记住我
            </label>
            <Link href="/forgot-password" className="text-muted-foreground hover:underline">
              忘记密码？
            </Link>
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "登录中…" : "登录"}
          </Button>
        </form>
      </TabsContent>

      {allowRegister && (
        <TabsContent value="register">
          <form onSubmit={doRegister} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="reg-email">邮箱</Label>
              <Input
                id="reg-email"
                type="email"
                required
                value={regData.email}
                onChange={(e) => setRegData({ ...regData, email: e.target.value })}
                placeholder="you@example.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reg-name">用户名</Label>
              <Input
                id="reg-name"
                required
                minLength={2}
                maxLength={20}
                value={regData.name}
                onChange={(e) => setRegData({ ...regData, name: e.target.value })}
                placeholder="2-20 位中英文/数字"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reg-password">密码</Label>
              <PasswordInput
                id="reg-password"
                required
                value={regData.password}
                onChange={(e) => setRegData({ ...regData, password: e.target.value })}
                placeholder="至少 8 位，含大小写字母和数字"
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "注册中…" : "注册"}
            </Button>
            <p className="text-xs text-muted-foreground">
              注册即表示同意本站服务条款。注册后会发送邮箱验证链接。
            </p>
          </form>
        </TabsContent>
      )}
    </Tabs>
  );
}
