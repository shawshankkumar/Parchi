/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PARCHI_API: string;
  readonly VITE_TURNSTILE_SITEKEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Cloudflare Turnstile global injected by the widget script.
interface Window {
  turnstile?: {
    render: (
      el: HTMLElement,
      opts: {
        sitekey: string;
        callback?: (token: string) => void;
        "expired-callback"?: () => void;
        "error-callback"?: () => void;
        theme?: "light" | "dark" | "auto";
      },
    ) => string;
    reset: (id?: string) => void;
    remove: (id?: string) => void;
  };
}
