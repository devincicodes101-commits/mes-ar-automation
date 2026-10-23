"use client";

import { useState } from "react";

export const PAGE_SIZE = 25;

/**
 * One page of a long list, and the props for <Pagination>.
 *
 * Rendering every row of a 5,000-line report made the screens slow to open,
 * so lists show a page at a time. `resetOn` is anything that changes what the
 * list holds (a search, a filter, a tab): when it changes, back to page one.
 */
export function usePaged<T>(items: T[], resetOn: unknown = null, pageSize = PAGE_SIZE) {
  const [page, setPage] = useState(0);
  const [seen, setSeen] = useState(resetOn);
  if (seen !== resetOn) {
    setSeen(resetOn);
    setPage(0);
  }
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const on = Math.min(page, pages - 1);
  return {
    shown: items.slice(on * pageSize, (on + 1) * pageSize),
    pager: { page: on, pageSize, total: items.length, onPage: setPage },
  };
}
