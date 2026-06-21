/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Sentry browser DSN. When unset, error monitoring stays disabled. */
  readonly VITE_SENTRY_DSN?: string;
  /** Optional release id for Sentry (associates events with source maps). */
  readonly VITE_SENTRY_RELEASE?: string;

  /** OpenEnv / H100 inference endpoint config. */
  readonly VITE_OVERFLOW_H100_ENDPOINT?: string;
  readonly VITE_OVERFLOW_API_KEY?: string;
  readonly VITE_OVERFLOW_MODEL?: string;
  readonly VITE_OPENENV_ENDPOINT?: string;
  readonly VITE_OPENENV_MODE?: string;

  /** OpenAI key for the natural-language scenario generator. */
  readonly VITE_OPENAI_API_KEY?: string;

  /** Overflow backend base URL (instrumented OpenAI proxy + Sentry tunnel). */
  readonly VITE_API_BASE?: string;
  /** When set, browser Sentry events route through the backend tunnel. */
  readonly VITE_SENTRY_TUNNEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
