/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next 16 writes an AGENTS.md into the repo on every dev run. Not wanted here.
  agentRules: false,
};

export default nextConfig;
