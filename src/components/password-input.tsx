"use client";

import { forwardRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";

// 密码输入框：右侧眼睛按钮切换明文/密文显示（登录/注册/改密码/各类密钥输入通用）
export const PasswordInput = forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  function PasswordInput({ className, type: _type, ...props }, ref) {
    const [show, setShow] = useState(false);
    return (
      <div className="relative">
        <Input ref={ref} type={show ? "text" : "password"} className={className ? `${className} pr-10` : "pr-10"} {...props} />
        <button
          type="button"
          tabIndex={-1}
          aria-label={show ? "隐藏密码" : "显示密码"}
          onClick={() => setShow((s) => !s)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    );
  }
);
PasswordInput.displayName = "PasswordInput";
