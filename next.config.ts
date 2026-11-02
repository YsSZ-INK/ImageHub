import type { NextConfig } from "next";
import WebpackObfuscator from "webpack-obfuscator";

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
  // 客户端 JS 混淆（仅生产构建的前端 bundle）：变量名十六进制化 + 字符串抽离，
  // 刻意不上控制流扁平化/自我保护等重选项——小核服务器跑不动，首屏会明显变慢
  webpack: (config, { dev, isServer }) => {
    if (!dev && !isServer) {
      config.plugins.push(
        new WebpackObfuscator({
          compact: true,
          simplify: true,
          identifierNamesGenerator: "hexadecimal",
          stringArray: true,
          stringArrayThreshold: 0.75,
          stringArrayRotate: true,
          stringArrayShuffle: true,
          splitStrings: true,
          splitStringsChunkLength: 8,
          unicodeEscapeSequence: false,
          selfDefending: false,
          controlFlowFlattening: false,
          deadCodeInjection: false,
          debugProtection: false,
          disableConsoleOutput: false,
          renameGlobals: false,
          sourceMap: false,
        })
      );
    }
    return config;
  },
  async headers() {
    // 水墨背景图：构建期资源、内容不变，长缓存（原图 1.5~2MB，重复协商 304 是无谓开销）
    const inkImmutable = [
      ...[1, 2, 3, 4].map((n) => ({
        source: `/ink-${n}.webp`,
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      })),
    ];
    return [
      ...inkImmutable,
      {
        // 全站基础安全响应头。
        // CSP 涉及 Next 内联脚本策略，为避免破坏功能暂不启用。
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
