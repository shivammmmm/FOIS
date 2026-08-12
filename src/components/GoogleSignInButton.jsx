import { useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
const SCRIPT_SRC = "https://accounts.google.com/gsi/client";

let scriptLoadPromise = null;
function loadGoogleScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!scriptLoadPromise) {
    scriptLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load Google Sign-In script"));
      document.head.appendChild(script);
    });
  }
  return scriptLoadPromise;
}

/**
 * "Continue with Google" button for Login/Signup. Renders Google's own
 * button once VITE_GOOGLE_CLIENT_ID is configured; otherwise shows a
 * disabled placeholder so the page still matches the design without a
 * broken/misleading live button.
 */
export default function GoogleSignInButton({ onSuccess, onError }) {
  const containerRef = useRef(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!CLIENT_ID) return;
    let cancelled = false;

    loadGoogleScript()
      .then(() => {
        if (cancelled || !containerRef.current) return;
        window.google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: async (response) => {
            try {
              const result = await base44.auth.google(response.credential);
              onSuccess?.(result);
            } catch (err) {
              const message = err?.message || "Google sign-in failed";
              setError(message);
              onError?.(message);
            }
          },
        });
        window.google.accounts.id.renderButton(containerRef.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          width: "100%",
          text: "continue_with",
        });
      })
      .catch((err) => setError(err.message));

    return () => {
      cancelled = true;
    };
  }, [onSuccess, onError]);

  if (!CLIENT_ID) {
    return (
      <button
        type="button"
        disabled
        title="Google Sign-In is not configured yet (set VITE_GOOGLE_CLIENT_ID / GOOGLE_CLIENT_ID)"
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-muted/40 py-2.5 text-sm font-medium text-muted-foreground cursor-not-allowed"
      >
        <GoogleIcon />
        Continue with Google
      </button>
    );
  }

  return (
    <div>
      <div ref={containerRef} className="flex w-full justify-center [&>div]:w-full" />
      {error && <div className="mt-2 text-xs text-red-600">{error}</div>}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.28 1.48-1.13 2.73-2.4 3.58v2.98h3.88c2.27-2.09 3.54-5.17 3.54-8.8z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-2.98c-1.08.72-2.45 1.15-4.05 1.15-3.11 0-5.75-2.1-6.69-4.93H1.3v3.09C3.26 21.3 7.31 24 12 24z" />
      <path fill="#FBBC05" d="M5.31 14.33c-.24-.72-.38-1.49-.38-2.28s.14-1.56.38-2.28V6.68H1.3A11.98 11.98 0 000 12.05c0 1.94.46 3.77 1.3 5.37l4.01-3.09z" />
      <path fill="#EA4335" d="M12 4.75c1.76 0 3.34.61 4.59 1.8l3.44-3.44C17.94 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.3 6.68l4.01 3.09c.94-2.83 3.58-4.93 6.69-4.93z" />
    </svg>
  );
}
