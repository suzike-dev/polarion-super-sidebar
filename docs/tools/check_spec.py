"""Validate documentation integrity and render review pages; no product tests."""
import csv
import hashlib
import json
import posixpath
import re
import urllib.parse
import zipfile
from pathlib import Path
import xml.etree.ElementTree as ET
import fitz
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent
base = "Polarion超级侧边栏_功能规格_v0.1"
md = (root / (base + ".md")).read_text(encoding="utf-8")
cases = json.loads((root / "验收用例_v0.1.json").read_text(encoding="utf-8"))
errors = []
req_ids = re.findall(r"^### ((?:FR|NFR)-\d+) ", md, re.M)
expected = [f"FR-{i:02}" for i in range(1, 25)] + [f"NFR-{i:02}" for i in range(1, 5)]
if sorted(req_ids) != sorted(expected):
    errors.append("Requirement definitions missing or duplicated")
if len(cases) != 40 or len({c["id"] for c in cases}) != 40:
    errors.append("Acceptance case count/uniqueness mismatch")
covered = {r for c in cases for r in c["requirements"]}
if set(req_ids) - covered:
    errors.append("Uncovered requirements: " + str(set(req_ids) - covered))
if covered - set(req_ids):
    errors.append("Undefined requirements: " + str(covered - set(req_ids)))
if any(c["status"] != "未执行" for c in cases):
    errors.append("Product acceptance must remain unexecuted")
for n in range(1, 18):
    if not re.search(r"\| Q" + str(n) + r" \|", md):
        errors.append(f"Missing decision Q{n}")
links = []
for match in re.finditer(r"!?\[[^\]]*\]\((<[^>]*>|[^)]*)\)", md):
    target = match.group(1).strip("<>")
    if re.match(r"https?://", target):
        continue
    p = Path(target) if re.match(r"[A-Za-z]:", target) else root / target
    links.append({"target": target, "exists": p.exists()})
    if not p.exists():
        errors.append("Missing local link: " + target)
rel_links = []
with zipfile.ZipFile(root / (base + ".docx")) as z:
    members = set(z.namelist())
    for name in z.namelist():
        if name.endswith(".xml") or name.endswith(".rels"):
            ET.fromstring(z.read(name))
        if name.endswith(".rels"):
            for rel in ET.fromstring(z.read(name)):
                if rel.attrib.get("TargetMode") == "External":
                    continue
                target = urllib.parse.unquote(rel.attrib["Target"])
                if target.startswith("/"):
                    resolved = target.lstrip("/")
                else:
                    parent = "" if name == "_rels/.rels" else posixpath.dirname(posixpath.dirname(name))
                    resolved = posixpath.normpath(posixpath.join(parent, target))
                if resolved not in members:
                    errors.append("Broken package relationship: " + name + " -> " + resolved)
    relroot = ET.fromstring(z.read("word/_rels/document.xml.rels"))
    for rel in relroot:
        if rel.attrib.get("Type", "").endswith("/hyperlink"):
            target = rel.attrib["Target"]
            if re.match(r"https?://", target):
                continue
            clean = urllib.parse.unquote(target)
            clean = re.sub(r"^file:///", "", clean)
            p = Path(clean) if re.match(r"[A-Za-z]:", clean) else root / clean
            rel_links.append({"target": target, "exists": p.exists()})
            if not p.exists():
                errors.append("Missing DOCX hyperlink: " + clean)
    dxml = ET.fromstring(z.read("word/document.xml"))
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    word_text = "".join(n.text or "" for n in dxml.findall(".//w:t", ns))
    for r in req_ids:
        if r not in word_text:
            errors.append("DOCX missing requirement " + r)
pdf = fitz.open(root / (base + ".pdf"))
pdf_text = "\n".join(p.get_text() for p in pdf)
for r in req_ids:
    if r not in pdf_text:
        errors.append("PDF missing requirement " + r)
review = root / "review"
review.mkdir(exist_ok=True)
page_meta, thumbnails = [], []
for i, page in enumerate(pdf):
    txt = page.get_text()
    if len(txt.strip()) < 30:
        errors.append(f"Nearly blank PDF page {i+1}")
    overflow = []
    for block in page.get_text("dict")["blocks"]:
        if "lines" not in block:
            continue
        for line in block["lines"]:
            for span in line["spans"]:
                x0, y0, x1, y1 = span["bbox"]
                if x0 < -1 or y0 < -1 or x1 > page.rect.width + 1 or y1 > page.rect.height + 1:
                    overflow.append(span["text"])
    if overflow:
        errors.append(f"Page {i+1} overflow: {overflow[:3]}")
    page_meta.append({"page": i+1, "characters": len(txt), "first_lines": txt.splitlines()[:4], "overflow": overflow})
    pix = page.get_pixmap(matrix=fitz.Matrix(0.65, 0.65), alpha=False)
    im = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
    tile = Image.new("RGB", (410, 585), "#E5EAF2")
    tile.paste(im, ((410-im.width)//2, 22))
    ImageDraw.Draw(tile).text((12, 5), f"Page {i+1}", fill="black")
    thumbnails.append(tile)
for group in range((len(thumbnails)+8)//9):
    contact = Image.new("RGB", (1230, 1755), "#E5EAF2")
    for j, im in enumerate(thumbnails[group*9:group*9+9]):
        contact.paste(im, ((j%3)*410, (j//3)*585))
    contact.save(review / f"contact-{group+1:02}.png")
for idx in [0, 1, 2, 3, 6, 7, 14, 20, len(pdf)-1]:
    if idx < len(pdf):
        pdf[idx].get_pixmap(matrix=fitz.Matrix(1.2, 1.2), alpha=False).save(review / f"page-{idx+1:02}.png")
manifest = []
for p in sorted(root.glob("*")):
    if p.is_file() and p.suffix in [".md", ".docx", ".pdf", ".csv", ".json"] and not p.name.startswith("交付检查"):
        manifest.append({"name": p.name, "bytes": p.stat().st_size, "sha256": hashlib.sha256(p.read_bytes()).hexdigest()})
result = {
    "status": "PASS" if not errors else "FAIL",
    "scope": "文档结构、追溯覆盖、资源链接、DOCX XML 和 PDF 完整性检查；不代表产品验收",
    "requirements": len(req_ids), "decisions": 17, "acceptance_cases": len(cases),
    "product_tests_status": "未执行", "pdf_pages": len(pdf),
    "local_links": links, "docx_local_links": rel_links, "page_metadata": page_meta,
    "manifest": manifest, "errors": errors
}
(root / "交付检查_v0.1.json").write_text(json.dumps(result, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
print(json.dumps({k: result[k] for k in ["status","requirements","decisions","acceptance_cases","pdf_pages","errors"]}, ensure_ascii=False))
if errors:
    raise SystemExit(1)
