"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { PasswordInput } from "@/components/password-input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/controls";
import Link from "next/link";

// 首页登录/注册表单
export function AuthForm({ allowRegister }: { allowRegister: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") || "/gallery";

  const [loginData, setLoginData] = useState({ email: "", password: "", remember: true });
  const [regData, setRegData] = useState({ email: "", name: "", password: "" });
  const [loading, setLoading] = useState(false);

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
        toast.error(res.code === "CALLBACK_ERROR" ? "登录失败" : "邮箱或密码错误");
        // 处理 authorize 抛出的封禁文案
        if (res.error.includes("封禁")) toast.error(res.error);
      } else {
        router.push(callbackUrl);
        router.refresh();
      }
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
        remember: "true",
        redirect: false,
      });
      if (!login?.error) {
        router.push(callbackUrl);
        router.refresh();
      }
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
              记住我（30 天）
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
