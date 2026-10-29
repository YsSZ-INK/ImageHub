import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 独立输出，便于 Docker 部署
  output: "standalone",
  // 图片一律通过受保护 API 路由访问，使用原生 <img> 懒加载
  images: { unoptimized: true },
  // 经过 middleware 的请求体上限（默认 10MB 会截断大图上传，上传路由另在 matcher 中排除）
  experimental: { middlewareClientMaxBodySize: "64mb" },
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
