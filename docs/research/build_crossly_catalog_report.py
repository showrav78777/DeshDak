from __future__ import annotations

import re
import sys
from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor


SOURCE = Path("/private/tmp/crossly-product-research/report-source.md")
OUTPUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("docs/Crossly_Product_Catalog_Deep_Research.docx")

NAVY = "16324F"
BLUE = "245D82"
TEAL = "1F7A78"
GOLD = "B78628"
INK = "18222D"
MUTED = "5D6975"
PALE = "EDF4F7"
LIGHT = "F4F6F8"
WHITE = "FFFFFF"
RED = "9B1C1C"


def shade(cell, fill: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_margins(cell, top=80, start=120, bottom=80, end=120) -> None:
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for tag, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn(f"w:{tag}"))
        if node is None:
            node = OxmlElement(f"w:{tag}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def set_table_widths(table, widths: list[int], indent=120) -> None:
    table.autofit = False
    tbl_pr = table._tbl.tblPr
    tbl_w = tbl_pr.first_child_found_in("w:tblW")
    tbl_w.set(qn("w:w"), str(sum(widths)))
    tbl_w.set(qn("w:type"), "dxa")
    tbl_ind = tbl_pr.first_child_found_in("w:tblInd")
    if tbl_ind is None:
        tbl_ind = OxmlElement("w:tblInd")
        tbl_pr.append(tbl_ind)
    tbl_ind.set(qn("w:w"), str(indent))
    tbl_ind.set(qn("w:type"), "dxa")
    grid = table._tbl.tblGrid
    for child in list(grid):
        grid.remove(child)
    for width in widths:
        col = OxmlElement("w:gridCol")
        col.set(qn("w:w"), str(width))
        grid.append(col)
    for row in table.rows:
        for idx, cell in enumerate(row.cells):
            tc_pr = cell._tc.get_or_add_tcPr()
            tc_w = tc_pr.first_child_found_in("w:tcW")
            tc_w.set(qn("w:w"), str(widths[idx]))
            tc_w.set(qn("w:type"), "dxa")
            set_cell_margins(cell)


def set_repeat_table_header(row) -> None:
    tr_pr = row._tr.get_or_add_trPr()
    repeat = OxmlElement("w:tblHeader")
    repeat.set(qn("w:val"), "true")
    tr_pr.append(repeat)


def keep_with_next(paragraph) -> None:
    paragraph.paragraph_format.keep_with_next = True


def set_run(run, *, size=None, color=INK, bold=None, italic=None, font="Aptos") -> None:
    run.font.name = font
    run._element.get_or_add_rPr().rFonts.set(qn("w:ascii"), font)
    run._element.get_or_add_rPr().rFonts.set(qn("w:hAnsi"), font)
    if size is not None:
        run.font.size = Pt(size)
    run.font.color.rgb = RGBColor.from_string(color)
    if bold is not None:
        run.bold = bold
    if italic is not None:
        run.italic = italic


def add_link(paragraph, label: str, url: str) -> None:
    part = paragraph.part
    rel_id = part.relate_to(url, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink", is_external=True)
    link = OxmlElement("w:hyperlink")
    link.set(qn("r:id"), rel_id)
    run = OxmlElement("w:r")
    r_pr = OxmlElement("w:rPr")
    color = OxmlElement("w:color")
    color.set(qn("w:val"), BLUE)
    underline = OxmlElement("w:u")
    underline.set(qn("w:val"), "single")
    r_pr.extend([color, underline])
    run.append(r_pr)
    text = OxmlElement("w:t")
    text.text = label
    run.append(text)
    link.append(run)
    paragraph._p.append(link)


def add_inline_markup(paragraph, text: str) -> None:
    url_pattern = re.compile(r"https?://[^\s]+")
    cursor = 0
    for match in url_pattern.finditer(text):
        before = text[cursor:match.start()]
        if before:
            add_emphasis_runs(paragraph, before)
        url = match.group(0).rstrip(".,)")
        trail = match.group(0)[len(url):]
        add_link(paragraph, url.replace("https://", "").split("/")[0], url)
        if trail:
            paragraph.add_run(trail)
        cursor = match.end()
    if cursor < len(text):
        add_emphasis_runs(paragraph, text[cursor:])


def add_emphasis_runs(paragraph, text: str) -> None:
    chunks = re.split(r"(`[^`]+`|\*[^*]+\*)", text)
    for chunk in chunks:
        if not chunk:
            continue
        if chunk.startswith("`") and chunk.endswith("`"):
            run = paragraph.add_run(chunk[1:-1])
            set_run(run, size=9.5, color=NAVY, font="Aptos Mono")
        elif chunk.startswith("*") and chunk.endswith("*"):
            run = paragraph.add_run(chunk[1:-1])
            set_run(run, italic=True, color=INK)
        else:
            run = paragraph.add_run(chunk)
            set_run(run, color=INK)


def add_page_number(paragraph) -> None:
    paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run = paragraph.add_run("PAGE ")
    set_run(run, size=8, color=MUTED, bold=True)
    fld_char1 = OxmlElement("w:fldChar")
    fld_char1.set(qn("w:fldCharType"), "begin")
    instr_text = OxmlElement("w:instrText")
    instr_text.set(qn("xml:space"), "preserve")
    instr_text.text = " PAGE "
    fld_char2 = OxmlElement("w:fldChar")
    fld_char2.set(qn("w:fldCharType"), "end")
    run._r.extend([fld_char1, instr_text, fld_char2])


def new_decimal_numbering(doc: Document) -> int:
    numbering = doc.part.numbering_part.element
    abstract_ids = [int(node.get(qn("w:abstractNumId"))) for node in numbering.findall(qn("w:abstractNum"))]
    num_ids = [int(node.get(qn("w:numId"))) for node in numbering.findall(qn("w:num"))]
    abstract_id = max(abstract_ids, default=0) + 1
    num_id = max(num_ids, default=0) + 1
    abstract = OxmlElement("w:abstractNum")
    abstract.set(qn("w:abstractNumId"), str(abstract_id))
    multi = OxmlElement("w:multiLevelType")
    multi.set(qn("w:val"), "singleLevel")
    abstract.append(multi)
    lvl = OxmlElement("w:lvl")
    lvl.set(qn("w:ilvl"), "0")
    start = OxmlElement("w:start")
    start.set(qn("w:val"), "1")
    fmt = OxmlElement("w:numFmt")
    fmt.set(qn("w:val"), "decimal")
    text = OxmlElement("w:lvlText")
    text.set(qn("w:val"), "%1.")
    suff = OxmlElement("w:suff")
    suff.set(qn("w:val"), "space")
    p_pr = OxmlElement("w:pPr")
    ind = OxmlElement("w:ind")
    ind.set(qn("w:left"), "720")
    ind.set(qn("w:hanging"), "360")
    p_pr.append(ind)
    lvl.extend([start, fmt, text, suff, p_pr])
    abstract.append(lvl)
    numbering.append(abstract)
    num = OxmlElement("w:num")
    num.set(qn("w:numId"), str(num_id))
    abstract_ref = OxmlElement("w:abstractNumId")
    abstract_ref.set(qn("w:val"), str(abstract_id))
    num.append(abstract_ref)
    numbering.append(num)
    return num_id


def set_paragraph_numbering(paragraph, num_id: int) -> None:
    p_pr = paragraph._p.get_or_add_pPr()
    num_pr = OxmlElement("w:numPr")
    ilvl = OxmlElement("w:ilvl")
    ilvl.set(qn("w:val"), "0")
    num_id_node = OxmlElement("w:numId")
    num_id_node.set(qn("w:val"), str(num_id))
    num_pr.extend([ilvl, num_id_node])
    p_pr.append(num_pr)


def border_bottom(paragraph, color=GOLD, size="18") -> None:
    p_pr = paragraph._p.get_or_add_pPr()
    p_bdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), size)
    bottom.set(qn("w:space"), "5")
    bottom.set(qn("w:color"), color)
    p_bdr.append(bottom)
    p_pr.append(p_bdr)


def add_callout(doc, label: str, text: str, fill=PALE) -> None:
    table = doc.add_table(rows=1, cols=1)
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    set_table_widths(table, [9360], indent=120)
    cell = table.cell(0, 0)
    shade(cell, fill)
    cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(3)
    r = p.add_run(label.upper())
    set_run(r, size=8.5, color=TEAL, bold=True)
    p2 = cell.add_paragraph()
    p2.paragraph_format.space_after = Pt(0)
    add_inline_markup(p2, text)
    doc.add_paragraph().paragraph_format.space_after = Pt(0)


def add_matrix(doc) -> None:
    heading = doc.add_paragraph("Decision at a glance", style="Heading 1")
    keep_with_next(heading)
    table = doc.add_table(rows=1, cols=3)
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    headers = ["Seller path", "Best use", "Publication rule"]
    for idx, text in enumerate(headers):
        cell = table.rows[0].cells[idx]
        shade(cell, NAVY)
        r = cell.paragraphs[0].add_run(text)
        set_run(r, size=9, color=WHITE, bold=True)
    rows = [
        ("Manual wizard", "Seller has no compatible website or needs one-off listing", "Draft → validation → seller confirmation → admin review"),
        ("Authenticated connector", "Supported store platform with official API", "Import preview → staged sync → admin review; signed webhooks + reconciliation"),
        ("Crossly Feed API", "Custom seller system or large catalog", "Schema validation/dry run → issue resolution → admin review"),
    ]
    for row_data in rows:
        cells = table.add_row().cells
        for idx, text in enumerate(row_data):
            if len(table.rows) % 2 == 1:
                shade(cells[idx], LIGHT)
            p = cells[idx].paragraphs[0]
            p.paragraph_format.space_after = Pt(0)
            r = p.add_run(text)
            set_run(r, size=9)
    set_repeat_table_header(table.rows[0])
    set_table_widths(table, [1900, 2920, 4540])
    doc.add_paragraph().paragraph_format.space_after = Pt(0)


def add_flow(doc) -> None:
    heading = doc.add_paragraph("Safe publication pipeline", style="Heading 2")
    keep_with_next(heading)
    labels = ["CONNECT", "SNAPSHOT", "NORMALIZE", "SECURE MEDIA", "REVIEW", "PUBLISH", "SYNC"]
    table = doc.add_table(rows=1, cols=len(labels))
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    widths = [1337] * 6 + [1338]
    for idx, label in enumerate(labels):
        cell = table.cell(0, idx)
        shade(cell, TEAL if idx in (0, 6) else PALE)
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(0)
        r = p.add_run(label)
        set_run(r, size=7.5, bold=True, color=WHITE if idx in (0, 6) else NAVY)
    set_table_widths(table, widths, indent=120)
    p = doc.add_paragraph("Nothing is searchable until the staged version passes the required checks and receives publication approval.")
    p.paragraph_format.space_before = Pt(4)
    p.paragraph_format.space_after = Pt(8)
    r = p.runs[0]
    set_run(r, size=9, color=MUTED, italic=True)


def add_phase_table(doc) -> None:
    heading = doc.add_paragraph("Recommended build sequence", style="Heading 1")
    keep_with_next(heading)
    rows = [
        ("0", "Commercial/API gate", "Signed rights, scopes, sandbox, display/retention rules"),
        ("1", "Rich manual catalog", "Schema, media pipeline, seller wizard, admin review, rich detail UI"),
        ("2", "Feed API + CSV", "Dry run, staged imports, issues, idempotency, pilot seller"),
        ("3", "Store connectors", "Shopify and WooCommerce, signed webhooks, reconciliation"),
        ("4", "International adapters", "Authorized search/detail/variant/stock/media, then operations"),
        ("5", "Optimization + mobile", "Search/image discovery, translations, quality, Flutter, new countries"),
    ]
    table = doc.add_table(rows=1, cols=3)
    table.style = "Table Grid"
    for idx, text in enumerate(("Phase", "Outcome", "Release gate")):
        shade(table.rows[0].cells[idx], NAVY)
        r = table.rows[0].cells[idx].paragraphs[0].add_run(text)
        set_run(r, size=9, color=WHITE, bold=True)
    for phase, outcome, gate in rows:
        cells = table.add_row().cells
        for idx, text in enumerate((phase, outcome, gate)):
            if int(phase) % 2:
                shade(cells[idx], LIGHT)
            r = cells[idx].paragraphs[0].add_run(text)
            set_run(r, size=9, bold=(idx == 0))
    set_repeat_table_header(table.rows[0])
    set_table_widths(table, [900, 2900, 5560])
    doc.add_paragraph().paragraph_format.space_after = Pt(0)


def configure_styles(doc: Document) -> None:
    styles = doc.styles
    normal = styles["Normal"]
    normal.font.name = "Aptos"
    normal._element.rPr.rFonts.set(qn("w:ascii"), "Aptos")
    normal._element.rPr.rFonts.set(qn("w:hAnsi"), "Aptos")
    normal.font.size = Pt(10.5)
    normal.font.color.rgb = RGBColor.from_string(INK)
    normal.paragraph_format.space_after = Pt(6)
    normal.paragraph_format.line_spacing = 1.1
    for name, size, color, before, after in (
        ("Heading 1", 16, BLUE, 16, 8),
        ("Heading 2", 13, BLUE, 12, 6),
        ("Heading 3", 11.5, NAVY, 9, 4),
    ):
        style = styles[name]
        style.font.name = "Aptos Display"
        style._element.rPr.rFonts.set(qn("w:ascii"), "Aptos Display")
        style._element.rPr.rFonts.set(qn("w:hAnsi"), "Aptos Display")
        style.font.size = Pt(size)
        style.font.bold = True
        style.font.color.rgb = RGBColor.from_string(color)
        style.paragraph_format.space_before = Pt(before)
        style.paragraph_format.space_after = Pt(after)
        style.paragraph_format.keep_with_next = True
    if "Source Note" not in styles:
        source_style = styles.add_style("Source Note", WD_STYLE_TYPE.PARAGRAPH)
    else:
        source_style = styles["Source Note"]
    source_style.font.name = "Aptos"
    source_style.font.size = Pt(8.5)
    source_style.font.color.rgb = RGBColor.from_string(MUTED)
    source_style.paragraph_format.space_after = Pt(4)
    for style_name in ("List Bullet", "List Number"):
        style = styles[style_name]
        style.font.name = "Aptos"
        style.font.size = Pt(10.25)
        style.paragraph_format.left_indent = Inches(0.5)
        style.paragraph_format.first_line_indent = Inches(-0.25)
        style.paragraph_format.space_after = Pt(5)
        style.paragraph_format.line_spacing = 1.1


def configure_section(section, first=False) -> None:
    section.top_margin = Inches(0.82)
    section.bottom_margin = Inches(0.78)
    section.left_margin = Inches(1.0)
    section.right_margin = Inches(1.0)
    section.header_distance = Inches(0.38)
    section.footer_distance = Inches(0.38)
    section.different_first_page_header_footer = first
    header = section.header
    p = header.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    p.paragraph_format.space_after = Pt(0)
    r = p.add_run("CROSSLY  /  PRODUCT CATALOG RESEARCH")
    set_run(r, size=8, color=MUTED, bold=True)
    border_bottom(p, color="D5DEE5", size="6")
    footer = section.footer
    fp = footer.paragraphs[0]
    add_page_number(fp)
    if first:
        first_header = section.first_page_header
        first_header.paragraphs[0].clear()
        first_footer = section.first_page_footer
        first_footer.paragraphs[0].clear()


def add_cover(doc: Document) -> None:
    section = doc.sections[0]
    section.different_first_page_header_footer = True
    for _ in range(4):
        doc.add_paragraph().paragraph_format.space_after = Pt(14)
    kicker = doc.add_paragraph()
    kicker.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = kicker.add_run("DEEP RESEARCH & IMPLEMENTATION BLUEPRINT")
    set_run(r, size=9.5, color=GOLD, bold=True)
    title = doc.add_paragraph()
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    title.paragraph_format.space_before = Pt(18)
    title.paragraph_format.space_after = Pt(10)
    r = title.add_run("Crossly Product Catalog,\nSeller Import & Marketplace Experience")
    set_run(r, size=28, color=NAVY, bold=True, font="Aptos Display")
    subtitle = doc.add_paragraph()
    subtitle.alignment = WD_ALIGN_PARAGRAPH.CENTER
    subtitle.paragraph_format.space_after = Pt(28)
    r = subtitle.add_run("A provider-neutral design for Bangladesh seller exports, authorized international sourcing, rich product media, trust and future Flutter clients")
    set_run(r, size=12.5, color=BLUE)
    rule = doc.add_paragraph()
    border_bottom(rule, color=GOLD, size="22")
    meta = doc.add_paragraph()
    meta.alignment = WD_ALIGN_PARAGRAPH.CENTER
    meta.paragraph_format.space_before = Pt(18)
    r = meta.add_run("Prepared for the founder and engineering team  •  27 August 2026")
    set_run(r, size=10, color=MUTED, bold=True)
    note = doc.add_paragraph()
    note.alignment = WD_ALIGN_PARAGRAPH.CENTER
    note.paragraph_format.space_before = Pt(58)
    r = note.add_run("Research conclusion")
    set_run(r, size=9, color=TEAL, bold=True)
    note2 = doc.add_paragraph()
    note2.alignment = WD_ALIGN_PARAGRAPH.CENTER
    note2.paragraph_format.left_indent = Inches(0.55)
    note2.paragraph_format.right_indent = Inches(0.55)
    r = note2.add_run("Build one Crossly-owned catalog and customer experience. Treat every external source as a private adapter behind staged review, provenance and security controls.")
    set_run(r, size=12, color=INK, bold=True)
    doc.add_page_break()


def add_contents(doc: Document) -> None:
    p = doc.add_paragraph("Reader guide", style="Heading 1")
    keep_with_next(p)
    intro = doc.add_paragraph("This report resolves what Crossly should build, why, how imported seller data should flow, and which capabilities remain blocked by external contracts or owner decisions.")
    intro.paragraph_format.space_after = Pt(10)
    items = [
        ("01", "Executive findings", "The decisions that govern the catalog"),
        ("02", "Evidence synthesis", "Alibaba, MoveOn and PDD patterns and limits"),
        ("03", "Ingestion architecture", "Manual, connector and feed paths"),
        ("04", "Catalog and product UX", "Canonical schema and rich detail page"),
        ("05", "Security and synchronization", "Media, rights, webhooks and provenance"),
        ("06", "Implementation roadmap", "Current gaps, phases, owners and gates"),
    ]
    table = doc.add_table(rows=0, cols=3)
    for idx, row in enumerate(items):
        cells = table.add_row().cells
        shade(cells[0], TEAL if idx % 2 == 0 else NAVY)
        shade(cells[1], PALE if idx % 2 == 0 else LIGHT)
        shade(cells[2], PALE if idx % 2 == 0 else LIGHT)
        for col, value in enumerate(row):
            r = cells[col].paragraphs[0].add_run(value)
            set_run(r, size=9 if col else 10, color=WHITE if col == 0 else INK, bold=col < 2)
    set_table_widths(table, [900, 2700, 5760])
    doc.add_paragraph().paragraph_format.space_after = Pt(0)
    add_callout(doc, "Evidence boundary", "The research supports product and operating design. It does not establish API entitlement, legal permission to copy media, customs classification, escrow status, or regulatory approval.", fill="FFF4DC")


def parse_markdown(doc: Document, markdown: str) -> None:
    lines = markdown.splitlines()
    skip_prefixes = ("# Crossly Product", "Research date:", "Audience:", "Decision:")
    phase_table_inserted = False
    flow_inserted = False
    current_num_id = None
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith(skip_prefixes):
            continue
        if line.startswith("## "):
            current_num_id = None
            title = line[3:]
            if title == "Phased implementation roadmap" and not phase_table_inserted:
                add_phase_table(doc)
                phase_table_inserted = True
            p = doc.add_paragraph(title, style="Heading 1")
            if title == "Import workflow" and not flow_inserted:
                add_flow(doc)
                flow_inserted = True
            continue
        if line.startswith("### "):
            current_num_id = None
            doc.add_paragraph(line[4:], style="Heading 2")
            continue
        if re.match(r"^\d+\. ", line):
            text = re.sub(r"^\d+\. ", "", line)
            if current_num_id is None:
                current_num_id = new_decimal_numbering(doc)
            p = doc.add_paragraph()
            p.paragraph_format.space_after = Pt(5)
            p.paragraph_format.line_spacing = 1.1
            set_paragraph_numbering(p, current_num_id)
            add_inline_markup(p, text)
            continue
        if line.startswith("- "):
            style = "Source Note" if "http" in line else "List Bullet"
            p = doc.add_paragraph(style=style)
            add_inline_markup(p, line[2:])
            continue
        p = doc.add_paragraph()
        add_inline_markup(p, line)


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    doc = Document()
    configure_styles(doc)
    add_cover(doc)
    add_contents(doc)
    add_matrix(doc)
    add_callout(
        doc,
        "Non-negotiable boundary",
        "Customers see Crossly product codes, normalized content, public seller identity and destination-aware commerce. They never see upstream marketplace branding, credentials, raw payloads, internal supplier references or supplier-only economics.",
    )
    parse_markdown(doc, SOURCE.read_text(encoding="utf-8"))
    for table in doc.tables:
        if table.rows:
            set_repeat_table_header(table.rows[0])
    for index, section in enumerate(doc.sections):
        configure_section(section, first=(index == 0))
    props = doc.core_properties
    props.title = "Crossly Product Catalog, Seller Import & Marketplace Experience"
    props.subject = "Deep research and implementation blueprint"
    props.author = "Crossly product and engineering research"
    props.keywords = "Crossly, product catalog, seller import, marketplace, APIs, media, security"
    doc.save(OUTPUT)
    print(OUTPUT.resolve())


if __name__ == "__main__":
    main()
