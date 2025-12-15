declare namespace Cloudflare {
  interface Env {
    /** Cloudflare account ID that owns the Workers AI API. */
    CLOUDFLARE_ACCOUNT_ID?: string

    /**
     * Cloudflare API token with permissions to call the Workers AI REST API.
     * Store as a Wrangler secret.
     */
    CLOUDFLARE_API_TOKEN?: string

    /** Optional override for the API base URL (default: https://api.cloudflare.com/client/v4). */
    CLOUDFLARE_AI_BASE_URL?: string
  }
}
