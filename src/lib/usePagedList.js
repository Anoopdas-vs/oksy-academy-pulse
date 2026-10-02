import { useMemo, useState } from "react";

// Client-side search + pagination for a table of rows already loaded in
// memory. `searchFields` lists which fields to match the search text
// against (case-insensitive substring match across all of them).
// Pure filter behind usePagedList (exported for tests).
export function filterRows(rows, query, searchFields) {
  if (!String(query || "").trim()) return rows;
  const q = String(query).toLowerCase();
  return rows.filter((row) => searchFields.some((field) => String(row[field] ?? "").toLowerCase().includes(q)));
}

export function usePagedList(rows, { searchFields = [], pageSize = 20 } = {}) {
  const [query, setQueryState] = useState("");
  const [page, setPage] = useState(1);

  const setQuery = (value) => {
    setQueryState(value);
    setPage(1);
  };

  const filtered = useMemo(() => {
    return filterRows(rows, query, searchFields);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  return {
    query,
    setQuery,
    page: safePage,
    setPage,
    totalPages,
    pageRows,
    filteredCount: filtered.length,
    totalCount: rows.length,
  };
}
