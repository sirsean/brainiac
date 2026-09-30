declare namespace Cloudflare {
  interface Env {
    /** Server-side secret, configured locally in .dev.vars and via wrangler secret in production. */
    OPENAI_API_KEY: string
  }
}
