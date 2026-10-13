"use client";

/**
 * Multi-select for 作品 and 生成记录 (第 58 条). Holds ids, not items, so a
 * list that reloads or grows keeps its selection; ids that leave the list
 * (deleted, filtered out) are dropped with `retain`.
 *
 * `toggle(id, { range: true })` (shift-click) selects every id between the
 * last one clicked and this one, in the order of `order` (what the user
 * sees), the way file managers do.
 */
import { useCallback, useMemo, useRef, useState } from "react";

export function useSelection(order: readonly string[]) {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());
  const anchor = useRef<string | null>(null);
  const orderRef = useRef(order);
  orderRef.current = order;

  const toggle = useCallback((id: string, options: { range?: boolean } = {}) => {
    // Read before the anchor moves: React runs the updater later.
    const from = anchor.current;
    const list = orderRef.current;
    setIds((prev) => {
      const next = new Set(prev);
      if (options.range && from && from !== id) {
        const a = list.indexOf(from);
        const b = list.indexOf(id);
        if (a >= 0 && b >= 0) {
          // The range takes the state of the anchor: shift-click after
          // selecting adds the span, after unselecting removes it.
          const on = prev.has(from);
          for (const item of list.slice(Math.min(a, b), Math.max(a, b) + 1)) {
            if (on) next.add(item);
            else next.delete(item);
          }
          return next;
        }
      }
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    anchor.current = id;
  }, []);

  /** Selects all of `group` when any is unselected, else unselects them all. */
  const toggleGroup = useCallback((group: readonly string[]) => {
    setIds((prev) => {
      const next = new Set(prev);
      const all = group.every((id) => prev.has(id));
      for (const id of group) {
        if (all) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setIds(new Set());
    anchor.current = null;
  }, []);

  /** Drops ids that are no longer in the list. */
  const retain = useCallback((keep: readonly string[]) => {
    const allowed = new Set(keep);
    setIds((prev) => {
      const next = new Set([...prev].filter((id) => allowed.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, []);

  return useMemo(
    () => ({
      ids,
      size: ids.size,
      has: (id: string) => ids.has(id),
      toggle,
      toggleGroup,
      clear,
      retain,
    }),
    [ids, toggle, toggleGroup, clear, retain],
  );
}

export type Selection = ReturnType<typeof useSelection>;
