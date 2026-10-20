/** @type {import('next').NextConfig} */
const nextConfig = {
  // Fully static build: parsing and storage run in the browser, so `out/` can be hosted anywhere.
  output: "export",
  trailingSlash: true,
};

export default nextConfig;
