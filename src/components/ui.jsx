import React, { useEffect, useId, useRef } from "react";

// Colour of the figure:
//   tone="pos" | "neg"  → force green / red
//   tone="auto"         → green when `amount` >= 0, red when < 0
//   positive (legacy)   → green
export function MetricCard({ label, value, icon, accent, positive, tone, amount, highlighted, locked }) {
  let colour = "";
  if (tone === "pos" || positive) colour = "positive";
  else if (tone === "neg") colour = "negative";
  else if (tone === "auto" && typeof amount === "number") {
    colour = amount < 0 ? "negative" : "positive";
  }

  return (
    <div className={highlighted ? "metric-card highlighted" : "metric-card"}>
      <div className="metric-top">
        <span className="metric-label">{label}</span>
        {icon && (
          <span className={accent ? `metric-icon accent-${accent}` : "metric-icon"}>{icon}</span>
        )}
      </div>
      <div className={`metric-value ${colour}`.trim()}>
        {locked ? <LockedValue /> : value}
      </div>
    </div>
  );
}

export function LockedValue() {
  return <span className="locked-value" title="Restricted — ask an admin for access">••••••</span>;
}

export function StatusBadge({ status }) {
  const cls =
    status === "Active"
      ? "active"
      : status === "Completed"
      ? "completed"
      : status === "Dropped"
      ? "dropped"
      : "registered";

  return <span className={`status-badge ${cls}`}>{status}</span>;
}

export function ErrorBanner({ message, error, children, className = "", style }) {
  const content = children || message || error;
  if (!content) return null;
  return (
    <div
      role="alert"
      className={`form-error-banner ${className}`.trim()}
      style={style}
    >
      {content}
    </div>
  );
}

export function Input({ label, value, onChange, type = "text", placeholder, error, id, ...rest }) {
  const generatedId = useId();
  const inputId =
    id ||
    (label
      ? `input-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-${generatedId.replace(/:/g, "")}`
      : generatedId);

  return (
    <div className="field">
      {label && <label htmlFor={inputId}>{label}</label>}
      <input
        id={inputId}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={error ? "field-invalid" : ""}
        {...rest}
      />
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}

export function Modal({ title, children, onClose }) {
  const titleId = useId();
  const modalRef = useRef(null);
  const overlayRef = useRef(null);
  // Latest onClose, read inside the effect below without being a dependency
  // of it. Callers pass a fresh inline onClose fn on every render; depending
  // on it directly used to re-run this mount effect on every keystroke
  // inside the modal, which re-focused the first focusable element (the ×
  // close button) after each character typed — breaking text entry in
  // every modal form.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const prevActive = document.activeElement;

    if (modalRef.current) {
      const focusable = modalRef.current.querySelector(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable) {
        focusable.focus();
      } else {
        modalRef.current.focus();
      }
    }

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (e.key === "Tab" && modalRef.current) {
        const focusables = Array.from(
          modalRef.current.querySelectorAll(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);
        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first || !modalRef.current.contains(document.activeElement)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last || !modalRef.current.contains(document.activeElement)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (prevActive && typeof prevActive.focus === "function") {
        prevActive.focus();
      }
    };
    // Run once on mount/unmount only — onClose is read via onCloseRef above,
    // so a new onClose reference on re-render must not re-run this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="modal-overlay"
      ref={overlayRef}
      onClick={(e) => {
        if (e.target === overlayRef.current) {
          onClose?.();
        }
      }}
    >
      <div
        ref={modalRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
      >
        <div className="modal-header">
          {title && <h3 id={titleId}>{title}</h3>}
          <button
            className="modal-close"
            type="button"
            aria-label="Close modal"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ReportCard({ title, text }) {
  return (
    <div className="report-card">
      <div className="report-icon">▤</div>
      <div>
        <h3>{title}</h3>
        <p>{text}</p>
      </div>
      <button className="edit-button">View</button>
    </div>
  );
}
