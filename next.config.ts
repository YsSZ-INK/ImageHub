import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 独立输出，便于 Docker 部署
  output: "standalone",
  // 图片一律通过受保护 API 路由访问，使用原生 <img> 懒加载
  images: { unoptimized: true },
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
