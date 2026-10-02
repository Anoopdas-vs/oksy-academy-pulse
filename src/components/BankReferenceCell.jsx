import React, { useState } from "react";
import { extractUtr } from "../lib/bankReference.js";

// Table cell body for a bank reference: UTR (if one can be extracted) in bold,
// full text in the tooltip, ellipsis-truncated, plus a copy-full-text button.
export default function BankReferenceCell({ value }) {
  const [copied, setCopied] = useState(false);
  const full = String(value ?? "").trim();
  if (!full) return <>-</>;
  const utr = extractUtr(full);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(full);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable (insecure context / denied): nothing to do */
    }
  };
  return (
    <span className="bankref-cell">
      <span className="bankref-text" title={full}>{utr ? <strong>{utr}</strong> : full}</span>
      <button
        type="button"
        className="bankref-copy"
        onClick={copy}
        title={copied ? "Copied" : "Copy bank reference"}
        aria-label="Copy bank reference"
      >
        {copied ? "✓" : "⧉"}
      </button>
    </span>
  );
}
