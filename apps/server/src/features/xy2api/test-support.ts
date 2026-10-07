import { vi } from "vitest";
import type { AdminSupabaseClient } from "../../supabase/admin.js";

type Row = Record<string, unknown>;
export function memoryDatabase(initial: Record<string, Row[]>) {
  const tables = structuredClone(initial);
  const uploads = vi.fn(async () => ({ error: null as unknown }));
  let failedClaim = false;
  function from(table: string) {
    const predicates: ((row: Row) => boolean)[] = [];
    let action = "read";
    let values: Row[] = [];
    let one = false;
    const query = {
      select(_columns?: string, _options?: unknown) {
        return query;
      },
      eq(key: string, value: unknown) {
        predicates.push((row) => row[key] === value);
        return query;
      },
      neq(key: string, value: unknown) {
        predicates.push((row) => row[key] !== value);
        return query;
      },
      in(key: string, value: unknown[]) {
        predicates.push((row) => value.includes(row[key]));
        return query;
      },
      order(_key: string) {
        return query;
      },
      limit(_count: number) {
        return query;
      },
      single() {
        one = true;
        return query;
      },
      maybeSingle() {
        one = true;
        return query;
      },
      update(value: Row) {
        action = "update";
        values = [value];
        return query;
      },
      insert(value: Row | Row[]) {
        action = "insert";
        values = Array.isArray(value) ? value : [value];
        return query;
      },
      upsert(value: Row | Row[]) {
        action = "upsert";
        values = Array.isArray(value) ? value : [value];
        return query;
      },
      delete() {
        action = "delete";
        return query;
      },
      // biome-ignore lint/suspicious/noThenProperty: Emulates the Supabase PromiseLike query protocol.
      then(
        resolve: (value: {
          data: Row | Row[] | null;
          error: unknown;
          count: number;
        }) => unknown,
      ) {
        tables[table] ??= [];
        const rows = tables[table];
        let selected = rows.filter((row) =>
          predicates.every((predicate) => predicate(row)),
        );
        if (
          failedClaim &&
          action === "update" &&
          values[0]?.billing_status === "pending"
        )
          return Promise.resolve(
            resolve({
              data: null,
              error: { message: "fixture write failure" },
              count: 0,
            }),
          );
        if (action === "update")
          for (const row of selected) Object.assign(row, values[0]);
        if (action === "insert") {
          rows.push(...structuredClone(values));
          selected = values;
        }
        if (action === "upsert") {
          for (const value of values) {
            const found = rows.find(
              (row) =>
                row.user_id === value.user_id &&
                (value.key_id === undefined || row.key_id === value.key_id),
            );
            if (found) Object.assign(found, structuredClone(value));
            else rows.push(structuredClone(value));
          }
          selected = values;
        }
        if (action === "delete")
          tables[table] = rows.filter((row) => !selected.includes(row));
        return Promise.resolve(
          resolve({
            data: structuredClone(one ? (selected[0] ?? null) : selected),
            error: null,
            count: selected.length,
          }),
        );
      },
    };
    return query;
  }
  const admin = {
    from,
    storage: {
      from: () => ({
        upload: uploads,
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://storage.example.com/${path}` },
        }),
      }),
    },
  } as unknown as AdminSupabaseClient;
  return {
    admin,
    tables,
    uploads,
    failClaim: () => {
      failedClaim = true;
    },
  };
}
