declare module "cloudflare:workers" {
  import type { AnyD1Database } from "drizzle-orm/d1";

  export const env: Record<string, unknown> & { DB?: AnyD1Database };
}
