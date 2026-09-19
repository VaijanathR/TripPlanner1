import { useState } from "react";
import { sharingApi } from "../api/sharing";

export default function ShareLink({ tripId }) {
  const [url, setUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [copyState, setCopyState] = useState("idle"); // idle | copied | failed

  async function handleGetLink() {
    setLoading(true);
    setError(null);
    setCopyState("idle");
    try {
      const { share_token } = await sharingApi.create(tripId);
      setUrl(`${window.location.origin}/share/${share_token}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <div className="share-link">
      {!url && (
        <button type="button" onClick={handleGetLink} disabled={loading}>
          {loading ? "Getting link…" : "Get share link"}
        </button>
      )}
      {error && (
        <p className="inline-error">
          Couldn't create a share link: {error}{" "}
          <button type="button" onClick={handleGetLink} disabled={loading}>
            Retry
          </button>
        </p>
      )}
      {url && (
        <div className="share-link-result">
          <input
            type="text"
            readOnly
            aria-label="Share link"
            value={url}
            onFocus={(e) => e.target.select()}
          />
          <button type="button" onClick={handleCopy}>
            Copy
          </button>
          {copyState === "copied" && <span className="copy-confirmation">Copied!</span>}
          {copyState === "failed" && (
            <span className="inline-error">Couldn't copy automatically — select the link and copy it.</span>
          )}
        </div>
      )}
    </div>
  );
}
