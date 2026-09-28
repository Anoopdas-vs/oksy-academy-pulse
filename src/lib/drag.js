// Pure helpers for the draggable Modal (see Modal's `draggable` prop in
// src/components/ui.jsx). Kept DOM-free so they can be unit tested.

// Desktop + mouse only; below the app's 900px layout breakpoint, or on touch
// screens, modals keep their fixed centred layout.
export const DRAG_MEDIA_QUERY = "(min-width: 901px) and (pointer: fine)";

// Minimum horizontal slice of the header that must stay on screen, so there
// is always something to grab to drag the modal back.
export const MIN_VISIBLE_PX = 80;

// Clamps a proposed drag offset (dx, dy — a CSS translate relative to the
// modal's centred position) so the modal's header stays reachable:
//   * its top edge never goes above the viewport top,
//   * the full header height stays above the viewport bottom,
//   * at least `minVisible` px of it stays within the left/right edges.
// `base` is the modal's bounding rect at zero offset ({ left, top, width }),
// `viewport` is { width, height }.
export function clampOffset({ dx, dy }, base, viewport, headerHeight, minVisible = MIN_VISIBLE_PX) {
  const keep = Math.min(minVisible, base.width);
  const minDx = keep - base.width - base.left;
  const maxDx = viewport.width - keep - base.left;
  const minDy = -base.top;
  const maxDy = viewport.height - headerHeight - base.top;
  return {
    dx: clamp(dx, minDx, Math.max(minDx, maxDx)),
    dy: clamp(dy, minDy, Math.max(minDy, maxDy)),
  };
}

function clamp(v, lo, hi) {
  return Math.min(Math.max(v, lo), hi);
}
