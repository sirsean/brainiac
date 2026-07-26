declare namespace Cloudflare {
  interface Env {
    /** Optional override for mood analysis; falls back to AI_TAGGER_MODEL. */
    AI_MOOD_MODEL?: string
    /** Optional override for therapy analysis; defaults in wrangler vars. */
    AI_THERAPY_MODEL?: string
  }
}
