import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/flows", destination: "/workflows", permanent: false },
      { source: "/flows/:id", destination: "/workflows/mail/:id", permanent: false },
    ];
  },
};

export default withWorkflow(nextConfig);
