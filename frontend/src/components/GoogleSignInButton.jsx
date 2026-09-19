import { useEffect, useRef, useState } from "react";

const GSI_SRC = "https://accounts.google.com/gsi/client";

let scriptPromise = null;
function loadGoogleScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = GSI_SRC;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => {
        scriptPromise = null; // allow a later retry
        reject(new Error("Google script failed to load"));
      };
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

// Google's own "Sign in with Google" button. Renders nothing unless
// VITE_GOOGLE_CLIENT_ID was set at build time. `onCredential` receives the
// Google ID token, which the backend verifies -- the client id is public,
// there is no secret in the browser.
export default function GoogleSignInButton({ onCredential }) {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const containerRef = useRef(null);
  const onCredentialRef = useRef(onCredential);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    onCredentialRef.current = onCredential;
  });

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    loadGoogleScript()
      .then(() => {
        if (cancelled) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => onCredentialRef.current(response.credential),
        });
        window.google.accounts.id.renderButton(containerRef.current, {
          theme: "outline",
          size: "large",
          text: "continue_with",
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (!clientId) return null;

  return (
    <div className="google-signin">
      <div ref={containerRef} />
      {failed && (
        <p className="inline-error">
          Google sign-in couldn't load. You can still use your email and password.
        </p>
      )}
    </div>
  );
}
