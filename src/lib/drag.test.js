// Unit tests for drag.js — the clamp that keeps a dragged Modal's header
// reachable (Modal `draggable` prop, used by the enrollment form).
//
// Run directly with: node --test src/lib/drag.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { clampOffset, MIN_VISIBLE_PX, DRAG_MEDIA_QUERY } from "./drag.js";

// A 760px-wide modal centred in a 1280x800 viewport, top at 40px.
const viewport = { width: 1280, height: 800 };
const base = { left: 260, top: 40, width: 760 };
const headerHeight = 60;

describe("clampOffset", () => {
  test("leaves an in-bounds offset untouched", () => {
    assert.deepEqual(clampOffset({ dx: 100, dy: 50 }, base, viewport, headerHeight), { dx: 100, dy: 50 });
    assert.deepEqual(clampOffset({ dx: 0, dy: 0 }, base, viewport, headerHeight), { dx: 0, dy: 0 });
  });

  test("header top can never go above the viewport", () => {
    const { dy } = clampOffset({ dx: 0, dy: -500 }, base, viewport, headerHeight);
    assert.equal(base.top + dy, 0);
  });

  test("the whole header stays above the viewport bottom", () => {
    const { dy } = clampOffset({ dx: 0, dy: 5000 }, base, viewport, headerHeight);
    assert.equal(base.top + dy + headerHeight, viewport.height);
  });

  test("at least MIN_VISIBLE_PX stays on screen when dragged far left", () => {
    const { dx } = clampOffset({ dx: -5000, dy: 0 }, base, viewport, headerHeight);
    const right = base.left + dx + base.width;
    assert.equal(right, MIN_VISIBLE_PX);
  });

  test("at least MIN_VISIBLE_PX stays on screen when dragged far right", () => {
    const { dx } = clampOffset({ dx: 5000, dy: 0 }, base, viewport, headerHeight);
    const left = base.left + dx;
    assert.equal(viewport.width - left, MIN_VISIBLE_PX);
  });

  test("clamps both axes at once (corner drag)", () => {
    const out = clampOffset({ dx: -9999, dy: -9999 }, base, viewport, headerHeight);
    assert.equal(base.top + out.dy, 0);
    assert.equal(base.left + out.dx + base.width, MIN_VISIBLE_PX);
  });

  test("a modal narrower than minVisible must stay fully on screen horizontally", () => {
    const narrow = { left: 100, top: 40, width: 50 };
    const left = clampOffset({ dx: -9999, dy: 0 }, narrow, viewport, headerHeight);
    assert.equal(narrow.left + left.dx, 0);
    const right = clampOffset({ dx: 9999, dy: 0 }, narrow, viewport, headerHeight);
    assert.equal(narrow.left + right.dx + narrow.width, viewport.width);
  });

  test("never returns a range inversion on a tiny viewport", () => {
    const tiny = { width: 60, height: 40 };
    const out = clampOffset({ dx: 0, dy: 0 }, base, tiny, headerHeight);
    assert.ok(Number.isFinite(out.dx) && Number.isFinite(out.dy));
    // Top stays pinned at the viewport top even when the header can't fully fit.
    assert.equal(base.top + out.dy, 0);
  });

  test("respects a custom minVisible", () => {
    const { dx } = clampOffset({ dx: 5000, dy: 0 }, base, viewport, headerHeight, 200);
    assert.equal(viewport.width - (base.left + dx), 200);
  });
});

describe("DRAG_MEDIA_QUERY", () => {
  test("limits dragging to wide, fine-pointer (mouse) screens", () => {
    assert.match(DRAG_MEDIA_QUERY, /min-width:\s*901px/);
    assert.match(DRAG_MEDIA_QUERY, /pointer:\s*fine/);
  });
});
