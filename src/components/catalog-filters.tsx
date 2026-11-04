import Link from "next/link";
import { CatalogFilterPanel } from "@/components/catalog-filter-panel";
import type { ReactNode } from "react";

export type CatalogFilterValues = {
  q?: string;
  category?: string;
  sort?: string;
  minPrice?: string;
  maxPrice?: string;
  priceBand?: string;
  availability?: string;
  origin?: string;
  delivery?: string;
  recency?: string;
};

const priceBands = [
  ["0-999", "৳0–৳999"], ["1000-2499", "৳1,000–৳2,499"], ["2500-4999", "৳2,500–৳4,999"], ["5000-9999", "৳5,000–৳9,999"], ["10000-plus", "৳10,000+"]
] as const;

function makeHref(basePath: string, values: CatalogFilterValues, changes: Partial<CatalogFilterValues>) {
  const next = { ...values, ...changes };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(next)) if (value) params.set(key, value);
  return `${basePath}${params.size ? `?${params.toString()}` : ""}`;
}

function FilterLink({ basePath, children, current, value, values, field, clear = false }: { basePath: string; children: ReactNode; current?: string; value: string; values: CatalogFilterValues; field: keyof CatalogFilterValues; clear?: boolean }) {
  const selected = current === value;
  const changes = clear || selected ? { [field]: "" } : { [field]: value };
  return <Link aria-current={selected ? "true" : undefined} className={`catalog-filter-option${selected ? " is-selected" : ""}`} href={makeHref(basePath, values, { ...changes, minPrice: field === "priceBand" ? "" : values.minPrice, maxPrice: field === "priceBand" ? "" : values.maxPrice })}><span aria-hidden="true" />{children}</Link>;
}

export function CatalogFilters({ values, basePath = "/products" }: { values: CatalogFilterValues; basePath?: string }) {
  const hasFilters = Boolean(values.minPrice || values.maxPrice || values.priceBand || values.availability || values.origin || values.delivery || values.recency);
  return <CatalogFilterPanel active={hasFilters}><aside className="catalog-filter-sidebar" aria-label="Product filters">
    <div className="catalog-filter-heading"><span aria-hidden="true">☷</span><h2>Filters</h2>{hasFilters ? <Link href={makeHref(basePath, values, { minPrice: "", maxPrice: "", priceBand: "", availability: "", origin: "", delivery: "", recency: "" })}>Clear</Link> : null}</div>
    <form action={basePath} className="catalog-price-filter">
      {values.q ? <input name="q" type="hidden" value={values.q} /> : null}{values.category ? <input name="category" type="hidden" value={values.category} /> : null}{values.sort ? <input name="sort" type="hidden" value={values.sort} /> : null}{values.availability ? <input name="availability" type="hidden" value={values.availability} /> : null}{values.origin ? <input name="origin" type="hidden" value={values.origin} /> : null}{values.delivery ? <input name="delivery" type="hidden" value={values.delivery} /> : null}{values.recency ? <input name="recency" type="hidden" value={values.recency} /> : null}
      <details open><summary>Price (BDT)<span>⌃</span></summary><div className="catalog-price-inputs"><input aria-label="Minimum price" min="0" name="minPrice" placeholder="Min" type="number" defaultValue={values.minPrice} /><input aria-label="Maximum price" min="0" name="maxPrice" placeholder="Max" type="number" defaultValue={values.maxPrice} /><button type="submit">Apply</button></div><div className="catalog-filter-options">{priceBands.map(([value, label]) => <FilterLink basePath={basePath} current={values.priceBand} field="priceBand" key={value} value={value} values={values}>{label}</FilterLink>)}</div></details>
    </form>
    <details className="catalog-filter-group" open><summary>Availability<span>⌃</span></summary><div className="catalog-filter-options"><FilterLink basePath={basePath} current={values.availability} field="availability" value="ready" values={values}>Ready to order</FilterLink><FilterLink basePath={basePath} current={values.availability} field="availability" value="stock" values={values}>In stock</FilterLink></div></details>
    <details className="catalog-filter-group" open><summary>Discover<span>⌃</span></summary><div className="catalog-filter-options"><FilterLink basePath={basePath} current={values.origin} field="origin" value="BD" values={values}>Bangladesh stores</FilterLink><FilterLink basePath={basePath} current={values.origin} field="origin" value="GLOBAL" values={values}>Global sourcing</FilterLink><FilterLink basePath={basePath} current={values.delivery} field="delivery" value="international" values={values}>International delivery</FilterLink></div></details>
    <details className="catalog-filter-group" open><summary>More filters<span>⌃</span></summary><div className="catalog-filter-options"><FilterLink basePath={basePath} current={values.recency} field="recency" value="7" values={values}>New: last 7 days</FilterLink><FilterLink basePath={basePath} current={values.recency} field="recency" value="30" values={values}>New: last 30 days</FilterLink></div></details>
    <p className="catalog-filter-note">Prices are catalog prices. Shipping and final warehouse charges are shown before you confirm an order.</p>
  </aside></CatalogFilterPanel>;
}
