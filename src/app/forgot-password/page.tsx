"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/account/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const json = await res.json();
      if (!json.ok) toast.error(json.error);
      else setSent(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>找回密码</CardTitle>
          <CardDescription>输入注册邮箱，我们会发送重置链接（开发环境打印到服务端控制台）</CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <p className="text-sm text-zinc-600">如邮箱存在，重置链接已发送。1 小时内有效。</p>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">邮箱</Label>
                <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "发送中…" : "发送重置链接"}
              </Button>
            </form>
          )}
          <Link href="/" className="mt-4 inline-block text-sm text-muted-foreground hover:underline">
            返回登录
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
