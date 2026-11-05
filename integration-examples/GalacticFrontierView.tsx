// REFERENCE ONLY — example wrapper for OrbitBtc's React frontend.
// Not compiled as part of this package (React is not a dependency here).
import { useEffect, useRef, useState } from "react";
import {
  mountGalacticFrontier,
  HttpBackendClient,
  RemoteSaveAdapter,
  type GalacticFrontierHandle,
  type GameOutEvent,
} from "@orbitbtc/galactic-frontier";

interface Props {
  apiBaseUrl: string;
  /** Return OrbitBtc auth headers for the signed-in user. */
  getAuthHeaders: () => Record<string, string> | Promise<Record<string, string>>;
  onEvent?: (e: GameOutEvent) => void;
}

export function GalacticFrontierView({ apiBaseUrl, getAuthHeaders, onEvent }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let handle: GalacticFrontierHandle | null = null;
    let cancelled = false;
    const backend = new HttpBackendClient({ baseUrl: apiBaseUrl, getAuthHeaders });
    mountGalacticFrontier(hostRef.current!, {
      backend,
      saveAdapter: new RemoteSaveAdapter(backend),
      onEvent,
    })
      .then((h) => {
        if (cancelled) h.dispose();
        else handle = h;
      })
      .catch((e) => setError(String(e?.message ?? e)));
    return () => {
      cancelled = true;
      void handle?.save();
      handle?.dispose();
    };
    // Mount once; the game manages its own lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) return <div role="alert">Galactic Frontier could not start: {error}</div>;
  return <div ref={hostRef} style={{ position: "fixed", inset: 0 }} />;
}

// Telegram Mini App usage (inside the Mini App page):
//   const tg = (window as any).Telegram?.WebApp;
//   tg?.ready(); tg?.expand(); tg?.disableVerticalSwipes?.();
//   <GalacticFrontierView apiBaseUrl="/api"
//      getAuthHeaders={() => ({ "X-Telegram-Init-Data": tg?.initData ?? "" })} />
