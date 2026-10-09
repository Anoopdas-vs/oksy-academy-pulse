import React, { useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fetchBookEntry } from "../lib/data.js";
import { findLoadedEntry, bookEntryDetail, resolveBookEntry, createDelayedClose } from "../lib/bookEntry.js";

import { BookEntryContext } from "./bookEntryContext.js";

const GAP = 6;
const MARGIN = 8;
const COPIED_MS = 1400;

// Clipboard write with a fallback for browsers/contexts without the async API.
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function CopyButton({ text, label, className = "" }) {
  const [state, setState] = useState("idle"); // idle | copied | failed
  useEffect(() => {
    if (state === "idle") return undefined;
    const t = setTimeout(() => setState("idle"), COPIED_MS);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <button
      type="button"
      className={`bep-copy ${state} ${className}`}
      onClick={async (e) => {
        e.stopPropagation();
        setState((await copyText(text)) ? "copied" : "failed");
      }}
    >
      {state === "copied" ? "✓ Copied" : state === "failed" ? "Copy failed" : label}
    </button>
  );
}

// Read-only detail popup for a Book ID.
//   Mouse: shown only while the pointer is on the ID or on the popup itself;
//          it hides automatically (after a short delay) as soon as the
//          pointer leaves both. A click never pins it open.
//   Keyboard: Tab focus on the ID opens it; blur / Esc closes it.
//   Touch: tap toggles; tap outside closes.
// The popup is a fixed-position portal, so it never shifts the table layout.
export default function BookEntryPopover({ kind, id, children }) {
  const { lists, students } = useContext(BookEntryContext);
  const anchor = useRef(null);
  const box = useRef(null);
  const lastPointer = useRef("mouse");
  const popId = useId();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [fetched, setFetched] = useState(null); // { status, detail } from the single-id fetch

  const loaded = findLoadedEntry(kind, id, lists);
  const view = loaded ? { status: "found", detail: bookEntryDetail(kind, loaded, students) } : fetched;

  // Not in memory: fetch just this entry, once per open until it resolves.
  useEffect(() => {
    if (!open || loaded || fetched) return undefined;
    let live = true;
    resolveBookEntry({ kind, id, lists, students, fetchEntry: fetchBookEntry }).then((r) => {
      if (live) setFetched(r);
    });
    return () => {
      live = false;
    };
  }, [open, loaded, fetched, kind, id, lists, students]);

  const place = useCallback(() => {
    const a = anchor.current?.getBoundingClientRect();
    const b = box.current?.getBoundingClientRect();
    if (!a || !b) return;
    const left = Math.max(MARGIN, Math.min(a.left, window.innerWidth - b.width - MARGIN));
    const below = a.bottom + GAP;
    const top = below + b.height + MARGIN > window.innerHeight && a.top - GAP - b.height >= MARGIN
      ? a.top - GAP - b.height
      : below;
    setPos({ left, top });
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setPos(null);
  }, []);
  const [{ schedule, cancel }] = useState(() => createDelayedClose(() => close()));
  const show = () => {
    cancel();
    setOpen(true);
  };
  useEffect(() => cancel, [cancel]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, view?.status, place]);

  useEffect(() => {
    if (!open) return undefined;
    const inside = (t) => anchor.current?.contains(t) || box.current?.contains(t);
    const onKey = (e) => e.key === "Escape" && (cancel(), close());
    const onDown = (e) => {
      if (!inside(e.target)) {
        cancel();
        close();
      }
    };
    // Safety net: if the pointer is anywhere else on the page, start the
    // auto-hide even when a mouseleave was missed (fast moves, scrolling).
    const onMove = (e) => {
      if (e.pointerType !== "mouse") return;
      if (inside(e.target)) cancel();
      else schedule();
    };
    const onWindowBlur = () => {
      cancel();
      close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("pointermove", onMove);
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointermove", onMove);
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place, cancel, schedule, close]);

  const d = view?.status === "found" ? view.detail : null;

  return (
    <>
      <span
        ref={anchor}
        className="book-entry-anchor"
        tabIndex={0}
        aria-describedby={open ? popId : undefined}
        onPointerDown={(e) => {
          lastPointer.current = e.pointerType;
        }}
        onPointerEnter={(e) => {
          if (e.pointerType === "mouse") show();
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") schedule();
        }}
        onFocus={(e) => {
          // Keyboard focus only. A mouse click also focuses the ID, and
          // that must not keep the popup pinned open.
          if (e.target.matches?.(":focus-visible")) show();
        }}
        onBlur={(e) => {
          if (!box.current?.contains(e.relatedTarget)) schedule();
        }}
        onClick={() => {
          // Touch has no hover: a tap toggles. Mouse is handled by hover.
          if (lastPointer.current === "mouse") return;
          if (open) close();
          else show();
        }}
      >
        {children}
      </span>
      {open &&
        createPortal(
          <div
            ref={box}
            id={popId}
            role="dialog"
            aria-label="Book entry details"
            className="book-entry-pop"
            onPointerEnter={cancel}
            onPointerLeave={(e) => {
              if (e.pointerType === "mouse") schedule();
            }}
            style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }}
          >
            {!view && <div className="bep-state book-entry-muted">Loading…</div>}
            {view?.status === "notfound" && <div className="bep-state book-entry-error">Entry not found</div>}
            {d && (
              <>
                <div className="bep-head">
                  <div>
                    <div className="bep-kind">{d.kindLabel}</div>
                    <div className="bep-code">{d.code}</div>
                  </div>
                  <CopyButton text={d.copyText} label="Copy all" className="bep-copy-all" />
                </div>
                <dl className="bep-grid">
                  {d.fields.map(([k, v]) => (
                    <div key={k} className={k === "Amount" ? "bep-row bep-amount" : "bep-row"}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
                <div className="bep-ref">
                  <div className="bep-ref-head">
                    <span>Bank reference</span>
                    {d.bankReference && <CopyButton text={d.bankReference} label="Copy" />}
                  </div>
                  <div className={d.bankReference ? "bep-ref-text" : "bep-ref-text empty"}>
                    {d.bankReference || "Not recorded"}
                  </div>
                </div>
              </>
            )}
          </div>,
          document.body
        )}
    </>
  );
}
