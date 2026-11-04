"use client";

export function PrintIdentifierButton() {
  return <button className="button primary print-identifier-button" onClick={() => window.print()} type="button">Print QR & barcode</button>;
}
