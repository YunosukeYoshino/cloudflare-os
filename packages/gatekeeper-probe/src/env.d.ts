// Project-specific Env/ctx.exports augmentation for Wrangler's generated types.

declare namespace Cloudflare {
  interface Env {
    BASE_URL?: string;
  }

  interface GlobalProps {
    mainModule: typeof import("./probe.js");
    durableNamespaces: "UserAccount" | "ProbeGatekeeperImpl";
  }
}

interface Env extends Cloudflare.Env {}
