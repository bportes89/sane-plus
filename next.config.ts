import type { NextConfig } from "next";

const allowedDevOrigins = (() => {
  const defaults = [
    "localhost",
    "127.0.0.1",
    "*.ngrok-free.app",
    "*.ngrok.app",
    "*.loca.lt",
    "*.trycloudflare.com",
  ];
  const raw =
    process.env.ALLOWED_DEV_ORIGINS ??
    process.env.NEXT_PUBLIC_ALLOWED_DEV_ORIGINS ??
    "";
  const list = raw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const merged = Array.from(new Set([...defaults, ...list]));
  return merged.length ? merged : undefined;
})();

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  allowedDevOrigins,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
    ],
  },
};

export default nextConfig;
