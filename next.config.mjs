/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next 16 writes an AGENTS.md into the repo on every dev run. Not wanted here.
  agentRules: false,
  // The dev badge sits bottom-left by default, on top of the phone score strip.
  devIndicators: { position: "top-right" },
};

export default nextConfig;
