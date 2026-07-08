import fs from 'node:fs';
import Papa from 'papaparse';

const file = process.argv[2];

if (!file) {
  console.error('Usage: node scripts/validate-sample.mjs /path/to/labs.csv');
  process.exit(1);
}

function parseNumber(raw) {
  if (raw === null || raw === undefined) return null;
  const source = String(raw).trim();
  if (!source) return null;
  const comparator = source.match(/^[<>]=?/);
  const cleaned = source.replace(/[^\d.-]/g, '');
  const value = Number.parseFloat(cleaned);
  if (Number.isNaN(value)) return null;
  return { value, comparator: comparator ? comparator[0] : null, raw: source };
}

function parseRange(range) {
  if (!range) return {};
  const text = String(range).trim();
  const pair = text.match(/(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)/);
  if (pair) return { low: Number(pair[1]), high: Number(pair[2]) };
  return {};
}

const csv = fs.readFileSync(file, 'utf8');
const { data, errors } = Papa.parse(csv, { header: true, skipEmptyLines: true });

if (errors.length) {
  console.error(errors);
  process.exit(1);
}

const normalized = data.flatMap((row) => {
  const parsed = parseNumber(row.value);
  if (!row.time || !row.marker || !parsed) return [];
  const range = parseRange(row.reference_range);
  return [{
    date: row.time,
    metric: row.marker,
    value: parsed.value,
    comparator: parsed.comparator,
    rawValue: parsed.raw,
    unit: row.unit,
    status: row.status,
    low: range.low,
    high: range.high,
  }];
});

const flagged = normalized.filter((record) => record.status === 'outOfRange');

console.log(JSON.stringify({
  rows: data.length,
  normalized: normalized.length,
  flagged: flagged.length,
  comparators: normalized.filter((record) => record.comparator).map((record) => ({
    metric: record.metric,
    rawValue: record.rawValue,
    value: record.value,
  })),
}, null, 2));
