import React, { useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fetchBookEntry } from "../lib/data.js";
import { findLoadedEntry, bookEntryFields, resolveBookEntry } from "../lib/bookEntry.js";

import { BookEntryContext } from "./bookEntryContext.js";

const GAP = 6;
const MARGIN = 8;

// Read-only detail popup for a Book ID. Hover / focus (desktop) or tap
// (touch) opens it; mouse leave, blur, tap outside or Esc closes it. The
// popup is a fixed-position portal, so it never shifts the table layout.
export default function BookEntryPopover({ kind, id, children }) {
  const { lists, students } = useContext(BookEntryContext);
  const anchor = useRef(null);
  const box = useRef(null);
  const lastPointer = useRef("mouse");
  const popId = useId();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [fetched, setFetched] = useState(null); // { status, fields } from the single-id fetch

  const loaded = findLoadedEntry(kind, id, lists);
  const view = loaded ? { status: "found", fields: bookEntryFields(kind, loaded, students) } : fetched;

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

  useLayoutEffect(() => {
    if (open) place();
  }, [open, view?.status, place]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    const onDown = (e) => {
      if (!anchor.current?.contains(e.target) && !box.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  const close = () => {
    setOpen(false);
    setPos(null);
  };

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
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={close}
        onFocus={() => setOpen(true)}
        onBlur={close}
        onClick={() => {
          // Touch has no hover: a tap toggles. A mouse click keeps it open.
          if (lastPointer.current === "mouse") setOpen(true);
          else setOpen((o) => !o);
        }}
      >
        {children}
      </span>
      {open &&
        createPortal(
          <div
            ref={box}
            id={popId}
            role="tooltip"
            className="book-entry-pop"
            style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }}
          >
            {!view && <span className="book-entry-muted">Loading…</span>}
            {view?.status === "notfound" && <span className="book-entry-error">Entry not found</span>}
            {view?.status === "found" && (
              <dl>
                {view.fields.map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>,
          document.body
        )}
    </>
  );
}
