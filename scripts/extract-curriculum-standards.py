"""Extract 2022 revised curriculum achievement standards from ministry PDFs.

The source PDFs are read-only inputs from the user's Downloads directory. Duplicate
source files are skipped by SHA-256. The generated JSON is intended to be reviewed
and committed with the application so the app does not need to parse PDFs at runtime.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from pypdf import PdfReader


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DOWNLOADS = Path.home() / "Downloads"
OUTPUT_PATH = PROJECT_ROOT / "data" / "achievement-standards.2022.json"
REPORT_PATH = PROJECT_ROOT / "data" / "achievement-standards.2022.md"
ELEMENTARY_ONLY = True


@dataclass(frozen=True)
class Source:
    subject: str
    filename: str
    elementary_code_marker: str


SOURCES = (
    Source("국어", "국어과 교육과정.pdf", "국"),
    Source("사회", "[별책7] 사회과 교육과정.pdf", "사"),
    Source("사회", "[별책7] 사회과 교육과정 (1).pdf", "사"),
    Source("수학", "수학과 교육과정 (1).pdf", "수"),
    Source("과학", "과학과 교육과정.pdf", "과"),
    Source("도덕", "[별책6] 도덕과 교육과정.pdf", "도"),
    Source("영어", "[별책14]+영어과+교육과정.pdf", "영"),
)

CODE_RE = re.compile(
    r"\[(?P<code>(?:12|9|6|4|2)[^\]\n]{1,28}?\d{2}-\d{2}(?:-\d{2})?)\]"
)
GRADE_HEADING_RE = re.compile(
    r"\[(?P<heading>(?:초등학교|중학교|고등학교)[^\]]*)\]"
)
DOMAIN_HEADING_RES = (
    re.compile(r"(?m)^\s*\((?P<number>\d{1,2})\)\s+(?P<title>[^\n]{1,100})$"),
    re.compile(
        r"\((?P<number>\d{1,2})\)\s+(?P<title>[^\n\[\(]{1,100}?)"
        r"(?=\s*\[(?:12|9|6|4|2)[^\]]{1,30}\])"
    ),
)

BOUNDARY_RE = re.compile(
    r"(?:\n\s*)?(?:"
    r"\(가\)\s*성취기준\s*해설|"
    r"\(나\)\s*성취기준\s*적용\s*시\s*고려\s*사항|"
    r"\([가-힣]\)\s*|"
    r"\(\d{1,2}\)\s+|"
    r"<[^>]{1,80}>|"
    r"\[(?:초등학교|중학교|고등학교|성취기준)[^\]]*\]|"
    r"(?:탐구\s*활동)\s*"
    r")"
)
PAGE_NO_RE = re.compile(r"^\s*-?\s*\d{1,3}\s*-?\s*$")
HEADER_RE = re.compile(
    r"^(?:(?:2022 개정 교육과정|교육부 고시 제2022-33호).*|"
    r"공통 교육과정|(?:국어|사회|수학|과학|도덕|영어)과 교육과정)$"
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source_file:
        for chunk in iter(lambda: source_file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def clean_domain(title: str) -> str:
    title = re.sub(r"\s+", " ", title).strip()
    title = re.split(r"\s{2,}|\[", title, maxsplit=1)[0].strip()
    return title[:80] or "영역 미분류"


def clean_content(raw: str) -> str:
    raw = raw.replace("\u00a0", " ").replace("⋅", "·")
    # Math PDFs encode subsection bullets as private/corrupted Hangul-looking
    # glyphs (for example "숔 네 자리 이하의 수"). When such a heading trails a
    # standard immediately before the next code, remove it from the content.
    raw = re.sub(r"\n\s*[\uC214-\uC23F]{1,3}\s+[^.?!\n]{1,50}\s*$", "", raw)
    boundary = BOUNDARY_RE.search(raw)
    if boundary:
        raw = raw[: boundary.start()]

    lines: list[str] = []
    for line in raw.splitlines():
        line = re.sub(r"\s+", " ", line).strip()
        if not line or PAGE_NO_RE.match(line) or HEADER_RE.match(line):
            continue
        lines.append(line)

    content = re.sub(r"\s+", " ", " ".join(lines)).strip().strip(" ·")
    if content.endswith("다"):
        content += "."
    return content


def find_domain_headings(text: str) -> list[re.Match[str]]:
    matches = [match for pattern in DOMAIN_HEADING_RES for match in pattern.finditer(text)]
    return sorted(matches, key=lambda match: match.start())


def classify_code(code: str) -> tuple[str, str]:
    if code.startswith("12"):
        return "고등학교", "고등학교"
    if code.startswith("9"):
        return "중학교", "1~3학년"
    if code.startswith("6"):
        return "초등학교", "5~6학년"
    if code.startswith("4"):
        return "초등학교", "3~4학년"
    return "초등학교", "1~2학년"


def extract_source(source: Source, path: Path) -> list[dict[str, object]]:
    reader = PdfReader(path)
    records: list[dict[str, object]] = []
    seen_codes: set[str] = set()
    current_domain = "영역 미분류"
    current_domain_number = ""
    current_heading = ""

    for page_number, page in enumerate(reader.pages, start=1):
        text = (page.extract_text() or "").replace("\r\n", "\n").replace("\r", "\n")
        text = text.translate(str.maketrans({"–": "-", "—": "-", "−": "-", "﹣": "-"}))
        codes = list(CODE_RE.finditer(text))
        if not codes:
            grade_matches = list(GRADE_HEADING_RE.finditer(text))
            domain_matches = find_domain_headings(text)
            if grade_matches:
                current_heading = grade_matches[-1].group("heading").strip()
            if domain_matches:
                current_domain = clean_domain(domain_matches[-1].group("title"))
                current_domain_number = domain_matches[-1].group("number").zfill(2)
            continue

        heading_events = [
            (match.start(), "grade", match.group("heading").strip())
            for match in GRADE_HEADING_RE.finditer(text)
        ]
        domain_events = [
            (
                match.start(),
                "domain",
                (match.group("number").zfill(2), clean_domain(match.group("title"))),
            )
            for match in find_domain_headings(text)
        ]
        code_events = [(match.start(), "code", match) for match in codes]

        for _, event_type, value in sorted(
            heading_events + domain_events + code_events, key=lambda event: event[0]
        ):
            if event_type == "grade":
                current_heading = str(value)
                continue
            if event_type == "domain":
                current_domain_number, current_domain = value
                continue

            match = value
            assert isinstance(match, re.Match)
            if re.search(r"[•￭■▪]\s*$", text[max(0, match.start() - 4) : match.start()]):
                # Codes repeated in the official explanation bullets are references,
                # not new achievement-standard entries.
                continue
            code = re.sub(r"\s+", "", match.group("code"))
            if code in seen_codes:
                continue

            code_domain_match = re.search(r"(\d{2})-\d{2}$", code)
            if code_domain_match and current_domain_number != code_domain_match.group(1):
                # Teaching notes sometimes cite a standard from the next domain
                # before that domain's actual standards box begins.
                continue

            match_index = codes.index(match)
            next_start = codes[match_index + 1].start() if match_index + 1 < len(codes) else len(text)
            raw_content = text[match.end() : next_start]
            content = clean_content(raw_content)
            if (
                match_index + 1 == len(codes)
                and content
                and not re.search(r"[.?!)]$", content)
                and page_number < len(reader.pages)
            ):
                next_page_text = (reader.pages[page_number].extract_text() or "").replace("\r\n", "\n").replace("\r", "\n")
                next_page_text = next_page_text.translate(str.maketrans({"–": "-", "—": "-", "−": "-", "﹣": "-"}))
                next_code = CODE_RE.search(next_page_text)
                continuation = next_page_text[: next_code.start()] if next_code else next_page_text
                content = clean_content(f"{raw_content}\n{continuation}")
            if len(content) < 4:
                continue

            school_level, grade_band = classify_code(code)
            if ELEMENTARY_ONLY and school_level != "초등학교":
                # The official subject PDFs are ordered elementary → middle → high.
                # Once the first non-elementary code appears, no later elementary
                # standards remain in that subject document.
                return records
            code_without_grade = re.sub(r"^(?:12|9|6|4|2)", "", code, count=1)
            if not code_without_grade.startswith(source.elementary_code_marker):
                # Some subject documents cite another subject's standard in the
                # teaching notes. Those references are not source standards.
                continue
            records.append(
                {
                    "code": code,
                    "content": content,
                    "subject": source.subject,
                    "schoolLevel": school_level,
                    "gradeBand": grade_band,
                    "domain": current_domain,
                    "sourceHeading": current_heading,
                    "curriculumYear": 2022,
                    "notice": "교육부 고시 제2022-33호",
                    "sourceFile": source.filename,
                    "sourcePage": page_number,
                }
            )
            seen_codes.add(code)

    return records


def build_report(records: list[dict[str, object]], skipped_duplicates: list[str]) -> str:
    by_subject = Counter(str(record["subject"]) for record in records)
    by_level = Counter(str(record["schoolLevel"]) for record in records)
    unclassified = [record for record in records if record["domain"] == "영역 미분류"]
    suspicious = [
        record
        for record in records
        if len(str(record["content"])) > 450
        or "성취기준 해설" in str(record["content"])
        or str(record["content"]).startswith(("이 성취기준은", "본 성취기준은"))
    ]

    lines = [
        "# 2022 개정 교육과정 성취기준 추출 보고서",
        "",
        f"- 전체 성취기준: **{len(records):,}개**",
        f"- 코드 중복: **{len(records) - len({str(record['code']) for record in records}):,}개**",
        f"- 영역 미분류: **{len(unclassified):,}개**",
        f"- 추가 검토 후보: **{len(suspicious):,}개**",
        f"- 제외한 완전 중복 PDF: **{', '.join(skipped_duplicates) if skipped_duplicates else '없음'}**",
        "",
        "## 교과별",
        "",
        "| 교과 | 성취기준 수 |",
        "|---|---:|",
    ]
    lines.extend(f"| {subject} | {count:,} |" for subject, count in sorted(by_subject.items()))
    lines.extend(
        [
            "",
            "## 학교급별",
            "",
            "| 학교급 | 성취기준 수 |",
            "|---|---:|",
        ]
    )
    lines.extend(f"| {level} | {count:,} |" for level, count in sorted(by_level.items()))

    if suspicious:
        lines.extend(["", "## 추가 검토 후보", ""])
        lines.extend(
            f"- `{record['code']}` {record['subject']} p.{record['sourcePage']}: "
            f"{str(record['content'])[:120]}"
            for record in suspicious[:30]
        )
    return "\n".join(lines) + "\n"


def main() -> None:
    all_records: list[dict[str, object]] = []
    seen_hashes: dict[str, str] = {}
    skipped_duplicates: list[str] = []

    for source in SOURCES:
        path = DOWNLOADS / source.filename
        if not path.exists():
            raise FileNotFoundError(f"Missing curriculum PDF: {path}")

        file_hash = sha256(path)
        if file_hash in seen_hashes:
            skipped_duplicates.append(f"{source.filename} (= {seen_hashes[file_hash]})")
            continue
        seen_hashes[file_hash] = source.filename
        all_records.extend(extract_source(source, path))

    all_records.sort(
        key=lambda record: (
            str(record["subject"]),
            {"초등학교": 0, "중학교": 1, "고등학교": 2}[str(record["schoolLevel"])],
            str(record["code"]),
        )
    )

    duplicate_codes = [
        code for code, count in Counter(str(record["code"]) for record in all_records).items() if count > 1
    ]
    if duplicate_codes:
        raise ValueError(f"Duplicate codes across records: {duplicate_codes[:20]}")

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(
        json.dumps(
            {
                "metadata": {
                    "curriculumYear": 2022,
                    "notice": "교육부 고시 제2022-33호",
                    "scope": "초등학교",
                    "generatedFrom": sorted(seen_hashes.values()),
                    "skippedDuplicates": skipped_duplicates,
                    "total": len(all_records),
                },
                "standards": all_records,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    REPORT_PATH.write_text(build_report(all_records, skipped_duplicates), encoding="utf-8")
    print(f"Wrote {len(all_records):,} standards to {OUTPUT_PATH}")
    print(f"Wrote validation report to {REPORT_PATH}")


if __name__ == "__main__":
    main()
