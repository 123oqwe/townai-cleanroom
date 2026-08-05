import type { NextConfig } from "next";

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000";

const nextConfig: NextConfig = {
  // The workspace client ships compiled JS under the `import` export
  // condition; transpile it for the bundler. (The package has no `development`
  // condition, so dev and build both consume `dist`.)
  transpilePackages: ["@town/web-client"],
  async rewrites() {
    return [
      {
        source: "/v1/:path*",
        destination: `${apiBase.replace(/\/$/, "")}/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
