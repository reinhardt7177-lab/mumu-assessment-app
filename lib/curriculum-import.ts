import { createHash, randomUUID } from "node:crypto";
import curriculum from "../data/achievement-standards.2022.json";
import { AppError } from "./assessment-domain";
import type { CurriculumImportContext, GradePlanTemplate, SchoolBasics, SourceDocument } from "./school-curriculum-domain";

type Cell = string | number | boolean | Date | null | undefined;
type ExtractedDocument = { text: string; rows: Cell[][] };
type Standard = (typeof curriculum.standards)[number];

const standardMap = new Map(curriculum.standards.map(item => [item.code, item]));
const subjects = new Set(["국어", "사회", "수학", "과학", "도덕", "영어"]);
const headerAliases: Record<string, string[]> = {
  order: ["순서", "단원번호", "번호"],
  grade: ["학년"],
  semester: ["학기"],
  subject: ["교과", "과목"],
  unit: ["단원", "단원명", "대단원"],
  standards: ["성취기준", "성취기준코드", "교육과정성취기준"],
  period: ["시기", "수업시기", "운영시기"],
  hours: ["시수", "차시"],
  assessmentTiming: ["평가시기", "평가일정"],
  assessmentMethods: ["평가방법", "평가방식"],
  assessmentFocus: ["평가요소", "평가내용", "평가중점"],
};

const normalizeHeader = (value: Cell) => String(value ?? "").toLowerCase().replace(/[\s·._()-]/g, "");
const cellText = (value: Cell) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? "").trim();
const compact = (value: string, max: number) => value.split("\u0000").join("").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
const gradeBand = (grade: number) => grade <= 2 ? "1~2학년" : grade <= 4 ? "3~4학년" : "5~6학년";

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  return rows;
}

async function extractPdf(buffer: Buffer) {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try { return compact((await parser.getText()).text, 500_000); }
  finally { await parser.destroy(); }
}

async function extractXlsx(buffer: Buffer) {
  const { readSheet } = await import("read-excel-file/node");
  const rows = await readSheet(buffer) as Cell[][];
  return { rows, text: compact(rows.map(row => row.map(cellText).join("\t")).join("\n"), 500_000) };
}

export async function extractCurriculumDocument(file: File): Promise<ExtractedDocument & { sha256: string }> {
  if (file.size <= 0 || file.size > 8_000_000) throw new AppError(413, "문서는 8MB 이하의 PDF·XLSX·CSV·TXT 파일만 사용할 수 있습니다.");
  const buffer = Buffer.from(await file.arrayBuffer());
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  let extracted: ExtractedDocument;
  if (extension === "pdf" || file.type === "application/pdf") {
    if (buffer.subarray(0, 4).toString("ascii") !== "%PDF") throw new AppError(415, "올바른 PDF 파일인지 확인해 주세요.");
    extracted = { text: await extractPdf(buffer), rows: [] };
  } else if (extension === "xlsx" || file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    if (buffer.subarray(0, 2).toString("ascii") !== "PK") throw new AppError(415, "올바른 XLSX 파일인지 확인해 주세요.");
    extracted = await extractXlsx(buffer);
  } else if (extension === "csv" || file.type === "text/csv") {
    const text = compact(new TextDecoder("utf-8").decode(buffer), 500_000);
    extracted = { text, rows: parseCsv(text) };
  } else if (extension === "txt" || file.type === "text/plain") {
    extracted = { text: compact(new TextDecoder("utf-8").decode(buffer), 500_000), rows: [] };
  } else throw new AppError(415, "PDF·XLSX·CSV·TXT 파일만 지원합니다. HWP는 PDF 또는 XLSX로 변환해 주세요.");
  return { ...extracted, sha256: createHash("sha256").update(buffer).digest("hex") };
}

function matchCodes(value: string) {
  const codes = [...value.matchAll(/[1-6](?:국|사|수|과|도|영)[0-9]{2}-[0-9]{2}/g)].map(match => match[0]);
  return [...new Set(codes)];
}

function allowedStandards(codes: string[], context: Pick<CurriculumImportContext, "grade" | "subject">) {
  return codes.filter(code => {
    const standard = standardMap.get(code);
    return standard?.subject === context.subject && standard.gradeBand === gradeBand(context.grade);
  });
}

function methods(value: string): GradePlanTemplate["units"][number]["assessmentMethods"] {
  const result: GradePlanTemplate["units"][number]["assessmentMethods"] = [];
  if (/서술|논술|글|지필/.test(value)) result.push("text");
  if (/사진|포트폴리오|작품/.test(value)) result.push("photo");
  if (/말|구술|발표|토의/.test(value)) result.push("speech");
  if (/대화|챗봇/.test(value)) result.push("chat");
  if (/관찰|실기|과정/.test(value)) result.push("observation");
  return result.length ? [...new Set(result)] : ["text"];
}

function headerMap(rows: Cell[][]) {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 25); rowIndex += 1) {
    const normalized = rows[rowIndex].map(normalizeHeader);
    const indexes: Record<string, number> = {};
    for (const [key, aliases] of Object.entries(headerAliases)) {
      const index = normalized.findIndex(value => aliases.includes(value));
      if (index >= 0) indexes[key] = index;
    }
    if (indexes.unit !== undefined || indexes.standards !== undefined) return { rowIndex, indexes };
  }
  return null;
}

function templatesFromRows(rows: Cell[][], context: CurriculumImportContext, warnings: string[]) {
  const header = headerMap(rows);
  if (!header) return [];
  const groups = new Map<string, GradePlanTemplate>();
  for (const row of rows.slice(header.rowIndex + 1)) {
    const read = (key: string) => header.indexes[key] === undefined ? "" : cellText(row[header.indexes[key]]);
    const title = read("unit");
    const rawCodes = matchCodes(read("standards"));
    if (!title && rawCodes.length === 0) continue;
    const grade = Math.min(6, Math.max(1, Number.parseInt(read("grade"), 10) || context.grade));
    const semester = (Number.parseInt(read("semester"), 10) === 2 ? 2 : context.semester) as 1 | 2;
    const rowSubject = subjects.has(read("subject")) ? read("subject") as CurriculumImportContext["subject"] : context.subject;
    const scope = `${grade}:${semester}:${rowSubject}`;
    let template = groups.get(scope);
    if (!template) {
      template = { key: randomUUID(), grade, semester, subject: rowSubject, notes: "", units: [] };
      groups.set(scope, template);
    }
    const codes = allowedStandards(rawCodes, { grade, subject: rowSubject });
    if (rawCodes.length !== codes.length) warnings.push(`${title || "이름 없는 단원"}에서 학년군·교과가 맞지 않는 성취기준 코드를 제외했습니다.`);
    const orderIndex = Math.min(99, Math.max(1, Number.parseInt(read("order"), 10) || template.units.length + 1));
    const existing = template.units.find(unit => unit.title === title || unit.orderIndex === orderIndex);
    if (existing) {
      existing.standardCodes = [...new Set([...existing.standardCodes, ...codes])];
      if (!existing.assessmentFocus) existing.assessmentFocus = read("assessmentFocus");
      continue;
    }
    template.units.push({
      key: randomUUID(), orderIndex, title: title || `${orderIndex}단원`, standardCodes: codes,
      plannedPeriod: read("period"), teachingHours: Number.parseInt(read("hours"), 10) || null,
      assessmentTiming: read("assessmentTiming"), assessmentMethods: methods(read("assessmentMethods")),
      assessmentFocus: read("assessmentFocus"),
    });
  }
  return [...groups.values()].map(template => ({ ...template, units: template.units.toSorted((a, b) => a.orderIndex - b.orderIndex) }));
}

function unitTitle(lines: string[], lineIndex: number, fallback: Standard | undefined) {
  for (let index = lineIndex; index >= Math.max(0, lineIndex - 5); index -= 1) {
    const line = lines[index].trim();
    const numbered = line.match(/^(?:제\s*)?([0-9]{1,2})\s*(?:단원|[.)])\s*(.{2,100})$/);
    if (numbered) return { order: Number(numbered[1]), title: numbered[2].trim() };
    const named = line.match(/^(.{2,100})\s+단원$/);
    if (named) return { order: 0, title: named[1].trim() };
  }
  return { order: 0, title: fallback?.domain || "문서에서 확인한 성취기준" };
}

function templateFromText(text: string, context: CurriculumImportContext, warnings: string[]) {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const grouped = new Map<string, { order: number; title: string; codes: string[] }>();
  lines.forEach((line, index) => {
    const rawCodes = matchCodes(line);
    const codes = allowedStandards(rawCodes, context);
    if (rawCodes.length !== codes.length) warnings.push("학년군·교과가 맞지 않는 성취기준 코드를 제외했습니다.");
    if (!codes.length) return;
    const title = unitTitle(lines, index, standardMap.get(codes[0]));
    const item = grouped.get(title.title) ?? { ...title, codes: [] };
    item.codes = [...new Set([...item.codes, ...codes])];
    grouped.set(title.title, item);
  });
  const units = [...grouped.values()].map((item, index) => ({
    key: randomUUID(), orderIndex: item.order || index + 1, title: item.title, standardCodes: item.codes,
    plannedPeriod: "", teachingHours: null, assessmentTiming: "", assessmentMethods: ["text"] as ["text"], assessmentFocus: "",
  })).toSorted((a, b) => a.orderIndex - b.orderIndex);
  if (!units.length) {
    warnings.push("성취기준 코드를 자동으로 찾지 못했습니다. 검토 화면에서 단원과 성취기준을 직접 추가해 주세요.");
    units.push({ key: randomUUID(), orderIndex: 1, title: "단원명을 확인해 주세요", standardCodes: [], plannedPeriod: "", teachingHours: null, assessmentTiming: "", assessmentMethods: ["text"], assessmentFocus: "" });
  }
  return { key: randomUUID(), grade: context.grade, semester: context.semester, subject: context.subject, notes: "", units } satisfies GradePlanTemplate;
}

function schoolBasics(text: string): SchoolBasics {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const section = (pattern: RegExp, max = 3000) => compact(lines.flatMap((line, index) => pattern.test(line) ? [line, lines[index + 1] ?? ""] : []).join("\n"), max);
  const focusAreas = [...new Set(lines.filter(line => /중점|특색|역점/.test(line)).map(line => compact(line, 300)))].slice(0, 30);
  const schoolEvents = lines.filter(line => /(?:[0-9]{1,2}[./월-][0-9]{1,2}|[0-9]{1,2}월).*(?:행사|방학|체험|축제|운동|휴업|재량)/.test(line))
    .slice(0, 100).map(line => ({ name: compact(line, 160), note: "" }));
  return {
    vision: section(/교육\s*(?:목표|비전)|학교\s*비전|교육상/),
    focusAreas,
    assessmentPolicy: section(/평가\s*(?:방침|원칙|계획)|학생평가/ , 5000),
    schoolEvents,
  };
}

export async function previewCurriculumDocument(file: File, context: CurriculumImportContext) {
  const extracted = await extractCurriculumDocument(file);
  const warnings: string[] = [];
  if (extracted.text.length < 20) warnings.push("텍스트를 거의 추출하지 못했습니다. 이미지형 PDF라면 OCR이 필요합니다.");
  if (/(?:01[016789]-?\d{3,4}-?\d{4})|(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})|(?:\d{6}-?[1-4]\d{6})/i.test(extracted.text)) {
    warnings.push("전화번호·이메일·주민등록번호 형태가 감지되었습니다. 원문은 저장하지 않지만 확정 전 개인정보 포함 여부를 확인해 주세요.");
  }
  let gradeTemplates: GradePlanTemplate[] = [];
  if (context.documentKind === "grade") {
    gradeTemplates = templatesFromRows(extracted.rows, context, warnings);
    if (!gradeTemplates.length) gradeTemplates = [templateFromText(extracted.text, context, warnings)];
  }
  const allCodes = [...new Set(gradeTemplates.flatMap(template => template.units.flatMap(unit => unit.standardCodes)))];
  const sourceDocument: SourceDocument = {
    name: file.name, mimeType: file.type || "application/octet-stream", sha256: extracted.sha256,
    documentKind: context.documentKind, extractedAt: new Date().toISOString(), detectedStandardCount: allCodes.length,
  };
  return {
    sourceDocument,
    schoolBasics: schoolBasics(extracted.text),
    gradeTemplates,
    matchedStandards: allCodes.map(code => standardMap.get(code)).filter(Boolean),
    warnings: [...new Set(warnings)],
    extraction: { characterCount: extracted.text.length, rowCount: extracted.rows.length },
  };
}
