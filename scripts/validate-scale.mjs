import fs from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';

const file = process.argv[2];

if (!file) {
  console.error('Usage: node scripts/validate-scale.mjs /path/to/scale.xlsx');
  process.exit(1);
}

function parseNumber(raw) {
  if (raw === null || raw === undefined) return null;
  const source = String(raw).trim();
  if (!source) return null;
  const cleaned = source.replace(/[^\d.-]/g, '');
  const value = Number.parseFloat(cleaned);
  if (Number.isNaN(value)) return null;
  return { value, raw: source };
}

function parseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function parseWorkbookRows(rows) {
  const headerIndex = rows.findIndex((row) => row.some((cell) => String(cell).trim() === 'Date and Time'));
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex].map((cell) => String(cell).trim());
  return rows.slice(headerIndex + 1).flatMap((row) => {
    const record = {};
    headers.forEach((header, index) => {
      if (header) record[header] = row[index];
    });
    return record['Date and Time'] ? [record] : [];
  });
}

function decodeXml(value) {
  return String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function columnIndex(ref) {
  const letters = String(ref).match(/[A-Z]+/)?.[0] || 'A';
  return [...letters].reduce((acc, char) => acc * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function parseSheetXml(xml) {
  const rows = [];
  const rowPattern = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch;
  while ((rowMatch = rowPattern.exec(xml))) {
    const row = [];
    const cellPattern = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let cellMatch;
    while ((cellMatch = cellPattern.exec(rowMatch[1]))) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const ref = attrs.match(/\br="([^"]+)"/)?.[1] || 'A';
      const column = columnIndex(ref);
      const inlineText = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
        .map((match) => decodeXml(match[1]))
        .join('');
      const value = inlineText || decodeXml(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] || '');
      row[column] = value;
    }
    rows.push(row);
  }
  return rows;
}

const archive = unzipSync(new Uint8Array(fs.readFileSync(file)));
const workbookRows = parseSheetXml(strFromU8(archive['xl/worksheets/sheet1.xml']));
const rows = parseWorkbookRows(workbookRows);
const metrics = [
  ['Weight', 'Weight(lb)'],
  ['Weight kg', 'Weight(kg)'],
  ['BMI', 'BMI'],
  ['Scale Body Fat %', 'Body Fat'],
  ['Muscle Mass', 'Muscle Mass'],
  ['Muscle Mass %', 'Muscle Mass %'],
  ['Water %', 'Body Water'],
  ['Lean Body Mass', 'Lean Body Mass'],
  ['Scale Bone Mass', 'Bone Mass'],
  ['Protein %', 'Protein'],
  ['Scale Visceral Fat', 'Visceral Fat'],
  ['BMR', 'BMR'],
  ['Metabolic Age', 'Metabolic Age'],
  ['Skeletal Muscle', 'Skeletal Muscle'],
  ['Skeletal Muscle Rate %', 'Skeletal Muscle Rate %'],
  ['Fat Content', 'Fat Content'],
  ['Subcutaneous Fat %', 'Subcutaneous Fat'],
];

const normalized = rows.flatMap((row) => {
  const date = parseDate(row['Date and Time']);
  if (!date) return [];
  return metrics.flatMap(([metric, key]) => {
    const parsed = parseNumber(row[key]);
    return parsed ? [{ date, metric, value: parsed.value, rawValue: parsed.raw }] : [];
  });
});

console.log(JSON.stringify({
  sheets: 1,
  rows: rows.length,
  normalized: normalized.length,
  firstDate: normalized[0]?.date,
  lastDate: normalized.at(-1)?.date,
  metrics: [...new Set(normalized.map((record) => record.metric))],
}, null, 2));
