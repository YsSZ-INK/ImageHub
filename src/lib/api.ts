import { NextResponse } from "next/server";
import { ZodError } from "zod";

// 统一业务错误
export class AppError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, data }, { status });
}

export function fail(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

// API 统一错误封装：route handler 用 handle 包裹（兼容 NextResponse 与原生 Response）
export function handle<A extends unknown[]>(
  fn: (...args: A) => Promise<Response>
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof AppError) return fail(err.message, err.status);
      if (err instanceof ZodError) {
        const msg = err.issues[0]?.message || "参数错误";
        return fail(msg, 422);
      }
      console.error("[api:error]", err);
      return fail("服务器内部错误", 500);
    }
  };
}

// 变更类请求的简单 Origin 校验（CSRF 加固，配合 SameSite=Lax Cookie）
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return; // 同源 fetch 或非浏览器客户端
  const host = req.headers.get("host");
  try {
    if (new URL(origin).host !== host) {
      throw new AppError("跨站请求被拒绝", 403);
    }
  } catch {
    throw new AppError("跨站请求被拒绝", 403);
  }
}
