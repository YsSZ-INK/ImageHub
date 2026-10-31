import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 独立输出，便于 Docker 部署
  output: "standalone",
  // 图片一律通过受保护 API 路由访问，使用原生 <img> 懒加载
  images: { unoptimized: true },
  // 经过 middleware 的请求体上限（默认 10MB 会截断大图上传，上传路由另在 matcher 中排除）
  experimental: { middlewareClientMaxBodySize: "64mb" },
  eslint: { ignoreDuringBuilds: true },
  // 备份打包库保持外部 require（standalone 输出自动追踪依赖）
  serverExternalPackages: ["tar"],
  async headers() {
    return [
      {
        // 安全员（渗透测试修复）：全站基础安全响应头。
        // CSP 涉及 Next 内联脚本策略，为避免破坏功能暂不启用（见安全报告建议）。
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
