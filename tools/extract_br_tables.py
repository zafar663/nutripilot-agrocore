import re, json, sys
import pdfplumber

def norm(s):
    return re.sub(r"\s+", " ", (s or "").strip())

def is_table_page(txt):
    t = txt or ""
    # Wide net: catch Table 1.xx and nutrient headings
    return ("Table" in t and ("Amino Acid" in t or "Main Components" in t or "Digestibility" in t)) or ("Table 1." in t)

def split_table_rows(lines):
    # Heuristic: rows often use multiple spaces as separators
    rows = []
    for ln in lines:
        if not ln: 
            continue
        # keep lines that look like they contain numbers
        if re.search(r"\d", ln) and len(ln) > 8:
            parts = re.split(r"\s{2,}", ln.strip())
            if len(parts) >= 3:
                rows.append(parts)
    return rows

def main():
    if len(sys.argv) < 3:
        print("Usage: python tools/extract_br_tables.py <pdf_path> <out_json_path>")
        sys.exit(1)

    pdf_path = sys.argv[1]
    out_path = sys.argv[2]

    out = {
        "_meta": {
            "pdf": pdf_path,
            "note": "Raw dump of suspected nutrient-table pages. Use tools/apply_br_extracted_dump.cjs to map into skeleton."
        },
        "pages": []
    }

    with pdfplumber.open(pdf_path) as pdf:
        for i, page in enumerate(pdf.pages):
            txt = page.extract_text() or ""
            if not is_table_page(txt):
                continue

            lines = [norm(x) for x in (txt.splitlines() if txt else []) if norm(x)]
            rows = split_table_rows(lines)

            out["pages"].append({
                "page": i + 1,
                "text_head": "\n".join(lines[:40]),
                "text_len": len(txt),
                "rows_sample": rows[:80]  # keep sample for debugging; we can increase later
            })

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print("Wrote:", out_path)
    print("Pages captured:", len(out["pages"]))

if __name__ == "__main__":
    main()
