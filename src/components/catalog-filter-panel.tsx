"use client";

import { useId, useState, type ReactNode } from "react";

export function CatalogFilterPanel({ children, active }: { children: ReactNode; active: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  return <div className="catalog-filter-panel">
    <button className="catalog-filter-toggle" type="button" aria-controls={panelId} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
      <span>{expanded ? "Hide filters" : "Show filters"}{active ? " · Filters applied" : ""}</span><span aria-hidden="true">{expanded ? "−" : "+"}</span>
    </button>
    <div className={`catalog-filter-panel-body${expanded ? " is-expanded" : ""}`} id={panelId}>{children}</div>
  </div>;
}
