import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// Reports use English labels and currency codes. Unsupported characters in
// customer-provided text are replaced; the original remains on the order page.
export async function createReportPdf(title: string, lines: string[], options: { demo?: boolean } = {}) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`DeshDak - ${title}`);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const safe = (text: string) => text.replace(/[^\x20-\x7E]/g, "?");
  let page = pdf.addPage([595, 842]); let y = 740; let number = 1;
  function header() {
    page.drawRectangle({ x: 0, y: 772, width: 595, height: 70, color: rgb(0.06, 0.24, 0.34) });
    page.drawText("DeshDak", { x: 40, y: 810, size: 18, font: bold, color: rgb(1, 1, 1) });
    page.drawText(safe(title).slice(0, 84), { x: 40, y: 788, size: 11, font, color: rgb(1, 1, 1) });
    page.drawText(`Page ${number}`, { x: 40, y: 24, size: 9, font });
    if (options.demo) page.drawText("DEMO - NOT VALID FOR TAX OR PAYMENT", { x: 145, y: 24, size: 10, font: bold, color: rgb(0.78, 0.2, 0.1) });
  }
  header();
  for (const line of lines) {
    const words = safe(line).split(/\s+/); const rows: string[] = []; let row = "";
    for (const word of words) {
      // Split long unbroken values as well as ordinary prose.
      for (let i = 0; i < word.length; i += 75) {
        const part = word.slice(i, i + 75); const candidate = row ? `${row} ${part}` : part;
        if (font.widthOfTextAtSize(candidate, 10) > 510) { rows.push(row); row = part; } else row = candidate;
      }
    }
    rows.push(row);
    for (const text of rows) {
      if (y < 60) { page = pdf.addPage([595, 842]); number++; y = 740; header(); }
      page.drawText(text, { x: 40, y, size: 10, font, color: rgb(0.08, 0.18, 0.25) }); y -= 16;
    }
    y -= 6;
  }
  return pdf.save();
}
