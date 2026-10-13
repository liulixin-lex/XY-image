// @vitest-environment jsdom
/**
 * 第 58 条: numbered pages, multi-select with shift-click spans, and handing
 * several pictures to the studio as references.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { pageItems } from "../src/components/ui/pager";
import { useSelection } from "../src/hooks/use-selection";
import { REFERENCE_HANDOFF_MAX, savePendingDraft, takePendingDraft } from "../src/lib/pending-prompt";

describe("pageItems", () => {
  it("lists every page when there are few", () => {
    expect(pageItems(1, 1)).toEqual([1]);
    expect(pageItems(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("keeps the ends and the pages around the current one, seven slots at most", () => {
    expect(pageItems(1, 20)).toEqual([1, 2, 3, 4, 5, "gap", 20]);
    expect(pageItems(10, 20)).toEqual([1, "gap", 9, 10, 11, "gap", 20]);
    expect(pageItems(20, 20)).toEqual([1, "gap", 16, 17, 18, 19, 20]);
    // A gap of one page shows the page itself.
    expect(pageItems(5, 8)).toEqual([1, "gap", 4, 5, 6, 7, 8]);
    for (let page = 1; page <= 30; page++) expect(pageItems(page, 30).length).toBeLessThanOrEqual(7);
  });
});

describe("useSelection", () => {
  const order = ["a", "b", "c", "d", "e"];

  it("toggles, selects a shift-click span, and a whole group", () => {
    const { result } = renderHook(() => useSelection(order));
    act(() => result.current.toggle("b"));
    act(() => result.current.toggle("d", { range: true }));
    expect([...result.current.ids].sort()).toEqual(["b", "c", "d"]);
    // A span from an unselected anchor clears it.
    act(() => result.current.toggle("c"));
    act(() => result.current.toggle("e", { range: true }));
    expect([...result.current.ids].sort()).toEqual(["b"]);
    act(() => result.current.toggleGroup(order));
    expect(result.current.size).toBe(5);
    act(() => result.current.toggleGroup(order));
    expect(result.current.size).toBe(0);
  });

  it("drops ids that left the list", () => {
    const { result } = renderHook(() => useSelection(order));
    act(() => result.current.toggleGroup(["a", "b", "c"]));
    act(() => result.current.retain(["a", "c", "z"]));
    expect([...result.current.ids].sort()).toEqual(["a", "c"]);
  });
});

describe("作参考 handoff", () => {
  afterEach(() => sessionStorage.clear());

  it("carries several references, at most REFERENCE_HANDOFF_MAX", () => {
    const refs = Array.from({ length: REFERENCE_HANDOFF_MAX + 3 }, (_, i) => ({
      url: `https://media.example/${i}.png`,
      assetId: `asset-${i}`,
      name: `图 ${i}`,
    }));
    savePendingDraft({ prompt: "", references: refs });
    const draft = takePendingDraft();
    expect(draft?.references).toHaveLength(REFERENCE_HANDOFF_MAX);
    expect(draft?.references?.[0]).toEqual(refs[0]);
    // Taken once.
    expect(takePendingDraft()).toBeNull();
  });
});
