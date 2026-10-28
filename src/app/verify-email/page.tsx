"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import Link from "next/link";

function VerifyInner() {
  const token = useSearchParams().get("token") ?? "";
  const [state, setState] = useState<"loading" | "ok" | "fail">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setState("fail");
      setMessage("链接无效");
      return;
    }
    fetch("/api/account/verify", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((r) => r.json())
      .then((json) => {
        if (json.ok) setState("ok");
        else {
          setState("fail");
          setMessage(json.error || "验证失败");
        }
      })
      .catch(() => {
        setState("fail");
        setMessage("网络错误");
      });
  }, [token]);

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>邮箱验证</CardTitle>
        <CardDescription>{state === "loading" ? "正在验证…" : message}</CardDescription>
      </CardHeader>
      <CardContent>
        <Link href="/gallery" className="text-sm text-primary hover:underline">
          进入画廊 →
        </Link>
      </CardContent>
    </Card>
  );
}

export default function VerifyEmailPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Suspense>
        <VerifyInner />
      </Suspense>
    </main>
  );
}
