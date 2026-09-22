const backend = process.env.BACKEND_API_URL || "http://127.0.0.1:4310";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingRoot: new URL("../..", import.meta.url).pathname,
  async rewrites() {
    return [
      { source: "/api/v1/:path*", destination: `${backend}/api/v1/:path*` },
      { source: "/evidence/:path*", destination: `${backend}/evidence/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
      {
        source: "/evidence/:path*",
        headers: [{ key: "Cache-Control", value: "public, immutable" }],
      },
    ];
  },
};

export default nextConfig;
