"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useClientReady } from "@/components/use-client-ready";

export type CatalogSortValue = "recommended" | "price_asc" | "price_desc" | "name_asc";

export function CatalogSort({ value }: { value: CatalogSortValue }) {
  const ready = useClientReady();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  function changeSort(next: CatalogSortValue) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "recommended") params.delete("sort"); else params.set("sort", next);
    params.delete("page");
    router.replace(`${pathname}${params.size ? `?${params.toString()}` : ""}`, { scroll: false });
  }

  return <label className="catalog-sort-control"><span>Sort by</span><select disabled={!ready} aria-label="Sort products" onChange={(event) => changeSort(event.target.value as CatalogSortValue)} value={value}>
    <option value="recommended">Recommended</option>
    <option value="price_asc">Price: low to high</option>
    <option value="price_desc">Price: high to low</option>
    <option value="name_asc">Name: A to Z</option>
  </select></label>;
}
