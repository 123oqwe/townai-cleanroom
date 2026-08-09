import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The workspace client ships compiled JS under the `import` export
  // condition; transpile it for the bundler. (The package has no `development`
  // condition, so dev and build both consume `dist`.)
  transpilePackages: ["@town/web-client"],
  async rewrites() {
    return [
      {
        // Route all /v1/* API calls through the authenticated server-side
        // proxy at /api/proxy/* instead of hitting the backend directly.
        // The proxy reads the HttpOnly session cookie and injects the
        // Bearer token — the token is never exposed to client-side JS.
        source: "/v1/:path*",
        destination: "/api/proxy/v1/:path*",
      },
    ];
  },
};

export default nextConfig;
