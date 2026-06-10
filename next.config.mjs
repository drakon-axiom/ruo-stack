/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow cross-origin dev requests from the Tailscale IP for testing on other devices.
  allowedDevOrigins: ['100.99.76.119'],
  images: {
    remotePatterns: [
      // Supabase Storage public buckets (product images, brand logos, COA thumbnails)
      { protocol: 'https', hostname: '*.supabase.co' },
    ],
  },
};

export default nextConfig;
