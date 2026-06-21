import { useEffect, useRef } from "react";

const SITEKEY = import.meta.env.VITE_TURNSTILE_SITEKEY;
const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

let scriptLoading: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptLoading) return scriptLoading;
  scriptLoading = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src^="https://challenges.cloudflare.com/turnstile"]`,
    );
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("turnstile load failed")));
      if (window.turnstile) resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("turnstile load failed"));
    document.head.appendChild(s);
  });
  return scriptLoading;
}

interface Props {
  onToken: (token: string) => void;
  onExpire?: () => void;
}

/**
 * Cloudflare Turnstile widget. If no sitekey is configured, renders a small
 * notice and immediately yields an empty token so the form remains usable in
 * dev / degraded environments (the Worker will reject if it truly requires one).
 */
export function Turnstile({ onToken, onExpire }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    if (!SITEKEY) {
      // No sitekey configured: signal an empty token (dev mode).
      onToken("");
      return;
    }
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !ref.current || !window.turnstile) return;
        widgetId.current = window.turnstile.render(ref.current, {
          sitekey: SITEKEY,
          theme: "auto",
          callback: (token: string) => onToken(token),
          "expired-callback": () => {
            onToken("");
            onExpire?.();
          },
          "error-callback": () => onToken(""),
        });
      })
      .catch(() => {
        /* widget unavailable; leave token empty */
      });
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetId.current);
        } catch {
          /* ignore */
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!SITEKEY) {
    return (
      <div className="turnstile-missing">
        Turnstile not configured (VITE_TURNSTILE_SITEKEY unset).
      </div>
    );
  }
  return <div ref={ref} className="turnstile-widget" />;
}
