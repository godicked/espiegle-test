"""
3_churro_to_transcription.py
============================
Fusionne les XML Churro d'un dossier (page-1.xml, page-2.xml, ...) en une seule
transcription data/transcriptions/<id>.xml.

Usage :
    uv run --with lxml scripts/3_churro_to_transcription.py <dossier_churro> <id>
    # ex : ... ~/ExperiencesOCR/AgreablesDivertissements nkl.c6ceava6
"""

import argparse
from pathlib import Path
from lxml import etree

DIR_TRANSCRIPTIONS = Path(__file__).parent.parent / "transcriptions"
NS = "http://example.com/historicaldocument"

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("dossier", type=Path, help="Dossier contenant les page-N.xml de Churro")
    parser.add_argument("id", help="Identifiant du livre dans le CSV (ex: nkl.c6ceava6)")
    args = parser.parse_args()
    INPUT_DIR = args.dossier
    FINAL_FILE = DIR_TRANSCRIPTIONS / f"{args.id}.xml"

    xml_files = sorted(INPUT_DIR.glob("page-*.xml"), key=lambda p: int(p.stem.split("-")[1]))

    root = etree.Element("HistoricalDocument", nsmap={None: NS})

    for xml_file in xml_files:
        page_number = int(xml_file.stem.split("-")[1])
        tree = etree.parse(xml_file)
        page = tree.find(f"{{{NS}}}Page")

        if page is None:
            print(f"⚠ {xml_file.name} : pas de balise <Page> trouvée, ignoré")
            continue

        page.set("n", str(page_number))
        root.append(page)
        print(f"✓ {xml_file.name} → page n={page_number}")

    FINAL_FILE.write_bytes(
        etree.tostring(root, pretty_print=True, xml_declaration=True, encoding="utf-8")
    )
    print(f"\n── {len(root)} pages écrites dans {FINAL_FILE} ──")

if __name__ == "__main__":
    main()
