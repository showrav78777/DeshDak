"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export type SellerProductFormValues = {
  titleEn: string; titleBn?: string | null; categoryId?: string | null; shortDescription?: string | null; description?: string | null; highlights: string[];
  brand?: string | null; modelNumber?: string | null; priceBdt?: string | number | null; inventoryQuantity?: number | null; stockStatus?: string | null;
  weightGrams?: number | null; lengthMm?: number | null; widthMm?: number | null; heightMm?: number | null; minimumOrderQuantity: number;
  productionLeadDaysMin?: number | null; productionLeadDaysMax?: number | null; sellingUnit?: string | null; packageContents?: string | null;
  sampleAvailable: boolean; customizationAvailable: boolean; returnPolicy?: string | null; warrantyInfo?: string | null; hsCode?: string | null;
  sku?: string | null; isInternationallyAvailable: boolean;
};

export function SellerProductForm({ categories, productId, productVersion, initialValues, readOnly = false }: { categories: { id: string; nameEn: string }[]; productId?: string; productVersion?: number; initialValues?: SellerProductFormValues; readOnly?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly) return;
    setError("");
    setSuccess("");
    setIsSubmitting(true);
    const payload = Object.fromEntries(new FormData(event.currentTarget));
    if (productVersion) payload.baseProductVersion = String(productVersion);
    const response = await fetch(productId ? `/api/v1/seller/products/${productId}/revisions` : "/api/v1/seller/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    setIsSubmitting(false);
    if (!response.ok) return setError(result.error?.message ?? "Could not submit product.");
    if (!productId) event.currentTarget.reset();
    setSuccess(productId ? "Changes submitted. Customers will keep seeing the last approved version until Admin approves this revision." : "Product submitted for admin review. It will remain private until approved.");
    router.refresh();
  }

  return <form className="seller-product-form" onSubmit={handleSubmit}>
    <fieldset className="seller-product-fields" disabled={readOnly}>
    <div className="seller-origin-note"><b>Product origin: Bangladesh</b><span>International delivery is handled through enabled DeshDak shipping lanes.</span></div>
    <label htmlFor="titleEn">Product name (English)</label><input id="titleEn" name="titleEn" defaultValue={initialValues?.titleEn} required />
    <label htmlFor="titleBn">Product name (Bangla)</label><input id="titleBn" name="titleBn" defaultValue={initialValues?.titleBn ?? ""} />
    <label htmlFor="sellerCategory">Category</label><select id="sellerCategory" name="categoryId" defaultValue={initialValues?.categoryId ?? ""} required><option value="">Choose a category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.nameEn}</option>)}</select>
    <label htmlFor="shortDescription">Short selling summary</label><textarea id="shortDescription" name="shortDescription" defaultValue={initialValues?.shortDescription ?? ""} minLength={10} maxLength={300} required placeholder="A clear one- or two-sentence summary shown near the product title." />
    <label htmlFor="description">Full description for worldwide customers</label><textarea id="description" name="description" defaultValue={initialValues?.description ?? ""} minLength={20} maxLength={3000} required />
    <label htmlFor="highlights">Key highlights <span>(one item per line)</span></label><textarea id="highlights" name="highlights" defaultValue={initialValues?.highlights.join("\n") ?? ""} minLength={3} maxLength={1500} required placeholder={"Material and construction\nMain customer benefit\nImportant size or use information"} />
    <div className="two-field"><div><label htmlFor="brand">Brand <span>(optional)</span></label><input id="brand" name="brand" defaultValue={initialValues?.brand ?? ""} maxLength={100} /></div><div><label htmlFor="modelNumber">Model number <span>(optional)</span></label><input id="modelNumber" name="modelNumber" defaultValue={initialValues?.modelNumber ?? ""} maxLength={100} /></div></div>
    <div className="two-field"><div><label htmlFor="priceBdt">Base price (BDT)</label><input id="priceBdt" name="priceBdt" defaultValue={initialValues?.priceBdt ?? ""} type="number" min="1" step="0.01" required /></div><div><label htmlFor="inventoryQuantity">Available quantity</label><input id="inventoryQuantity" name="inventoryQuantity" defaultValue={initialValues?.inventoryQuantity ?? ""} type="number" min="0" max="1000000" required /></div></div>
    <div className="two-field"><div><label htmlFor="stockStatus">Stock status</label><select id="stockStatus" name="stockStatus" defaultValue={initialValues?.stockStatus ?? "IN_STOCK"} required><option value="IN_STOCK">In stock</option><option value="MADE_TO_ORDER">Made to order</option><option value="OUT_OF_STOCK">Out of stock</option></select></div><div><label htmlFor="weightGrams">Packed weight (grams)</label><input id="weightGrams" name="weightGrams" defaultValue={initialValues?.weightGrams ?? ""} type="number" min="1" max="1000000" required /></div></div>
    <fieldset className="dimension-fields"><legend>Packed dimensions (millimetres)</legend><label htmlFor="lengthMm">Length<input id="lengthMm" name="lengthMm" defaultValue={initialValues?.lengthMm ?? ""} type="number" min="1" max="100000" required /></label><label htmlFor="widthMm">Width<input id="widthMm" name="widthMm" defaultValue={initialValues?.widthMm ?? ""} type="number" min="1" max="100000" required /></label><label htmlFor="heightMm">Height<input id="heightMm" name="heightMm" defaultValue={initialValues?.heightMm ?? ""} type="number" min="1" max="100000" required /></label></fieldset>
    <fieldset className="commerce-term-fields"><legend>Order and production terms</legend><div className="two-field"><div><label htmlFor="minimumOrderQuantity">Minimum order quantity</label><input id="minimumOrderQuantity" name="minimumOrderQuantity" type="number" min="1" max="1000000" defaultValue={initialValues?.minimumOrderQuantity ?? 1} required /></div><div><label htmlFor="sellingUnit">Selling unit</label><input id="sellingUnit" name="sellingUnit" defaultValue={initialValues?.sellingUnit ?? ""} maxLength={80} placeholder="piece, set, carton" required /></div></div><div className="two-field"><div><label htmlFor="productionLeadDaysMin">Minimum production days</label><input id="productionLeadDaysMin" name="productionLeadDaysMin" defaultValue={initialValues?.productionLeadDaysMin ?? ""} type="number" min="0" max="3650" required /></div><div><label htmlFor="productionLeadDaysMax">Maximum production days</label><input id="productionLeadDaysMax" name="productionLeadDaysMax" defaultValue={initialValues?.productionLeadDaysMax ?? ""} type="number" min="0" max="3650" required /></div></div><label htmlFor="packageContents">Package contents</label><textarea id="packageContents" name="packageContents" defaultValue={initialValues?.packageContents ?? ""} minLength={3} maxLength={1000} required placeholder="List everything included in one selling unit." /></fieldset>
    <div className="seller-capability-options"><label className="seller-checkbox" htmlFor="sampleAvailable"><input id="sampleAvailable" name="sampleAvailable" type="checkbox" defaultChecked={initialValues?.sampleAvailable ?? false} /><span>Customers may request a sample.</span></label><label className="seller-checkbox" htmlFor="customizationAvailable"><input id="customizationAvailable" name="customizationAvailable" type="checkbox" defaultChecked={initialValues?.customizationAvailable ?? false} /><span>Customization or private-label service is available.</span></label></div>
    <label htmlFor="returnPolicy">Seller return policy <span>(optional; DeshDak policy still applies)</span></label><textarea id="returnPolicy" name="returnPolicy" defaultValue={initialValues?.returnPolicy ?? ""} maxLength={1200} />
    <label htmlFor="warrantyInfo">Warranty information <span>(optional)</span></label><textarea id="warrantyInfo" name="warrantyInfo" defaultValue={initialValues?.warrantyInfo ?? ""} maxLength={1200} />
    <label htmlFor="hsCode">HS code <span>(optional; admin/compliance will verify)</span></label><input id="hsCode" name="hsCode" defaultValue={initialValues?.hsCode ?? ""} maxLength={20} placeholder="Example: 6204.62" />
    <label htmlFor="sku">Your SKU <span>(optional)</span></label><input id="sku" name="sku" defaultValue={initialValues?.sku ?? ""} />
    <label className="seller-checkbox" htmlFor="isInternationallyAvailable"><input id="isInternationallyAvailable" name="isInternationallyAvailable" type="checkbox" defaultChecked={initialValues?.isInternationallyAvailable ?? true} /><span>Make this product available to international customers after approval.</span></label>
    </fieldset>
    {error ? <p className="form-error" role="alert">{error}</p> : null}{success ? <p className="form-success" role="status">{success}</p> : null}
    {!readOnly ? <button className="button primary" disabled={isSubmitting || categories.length === 0} type="submit">{isSubmitting ? "Submitting…" : categories.length ? productId ? "Submit changes for review" : "Submit for review" : "No active categories"}</button> : null}
  </form>;
}
