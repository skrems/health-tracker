import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Papa from 'papaparse';
import { strFromU8, unzipSync } from 'fflate';
import {
  Activity,
  BarChart3,
  CalendarDays,
  Database,
  Download,
  HardDrive,
  FolderSync,
  FileUp,
  FlaskConical,
  FileText,
  Layers3,
  LineChart as LineChartIcon,
  LogOut,
  Printer,
  RotateCcw,
  Scale,
  ScanLine,
  Search,
  Syringe,
  TrendingDown,
  TrendingUp,
  Upload,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import './styles.css';

const STORAGE_KEY = 'health-tracker-state-v1';
const DATA_SOURCES = ['labs', 'dexa', 'scale', 'glucose'];
const IMPORT_SOURCES = ['labs', 'dexa', 'scale'];
const FASTING_GLUCOSE_METRIC = 'Fasting Glucose';
const BEDTIME_GLUCOSE_METRIC = 'Bedtime Glucose';
const GLUCOSE_SOURCE_ALIASES = ['glucose', 'blood_glucose', 'blood_sugar', 'fasting_glucose', 'morning_glucose', 'bedtime_glucose', 'evening_glucose'];
const APP_VERSION = import.meta.env.VITE_APP_VERSION || 'development';

const SOURCE_META = {
  labs: {
    label: 'Bloodwork',
    icon: FlaskConical,
    color: '#246bfe',
    accepted: 'marker,value,unit,reference_range,status,time',
    copy: 'Monthly or bimonthly lab panel exports.',
  },
  dexa: {
    label: 'DEXA',
    icon: ScanLine,
    color: '#0f8f83',
    accepted: 'BodySpec master/region/bone/percentile/RMR CSVs or date,metric,value,unit',
    copy: 'Quarterly BodySpec or DEXA body composition exports.',
  },
  scale: {
    label: 'Scale',
    icon: Scale,
    color: '#a34f00',
    accepted: 'Wyze .xlsx exports or CSV with date,weight_lbs,body_fat_pct,muscle_mass_lbs',
    copy: 'Daily Wyze Body Scan Pro exports.',
  },
  glucose: {
    label: 'Daily Glucose',
    icon: Activity,
    color: '#b3265e',
    accepted: 'Manual fasting and bedtime readings in mg/dL',
    copy: 'Daily wake-up fasting and bedtime blood sugar readings.',
  },
};

const INITIAL_STATE = {
  labs: [],
  dexa: [],
  scale: [],
  glucose: [],
};

const METHOD_COLORS = {
  dexa: '#0f8f83',
  scale: '#a34f00',
};

const COMPARISON_METRICS = [
  {
    id: 'weight',
    label: 'Weight',
    unit: 'lb',
    note: 'DEXA scan weight compared with daily Wyze scale weight.',
    series: [
      { key: 'dexaWeight', source: 'dexa', metric: 'DEXA Weight', label: 'DEXA Weight', color: METHOD_COLORS.dexa },
      { key: 'scaleWeight', source: 'scale', metric: 'Weight', label: 'Wyze Weight', color: METHOD_COLORS.scale },
    ],
  },
  {
    id: 'bodyFatPct',
    label: 'Body Fat %',
    unit: '%',
    note: 'DEXA body fat percentage compared with Wyze impedance body fat percentage.',
    series: [
      { key: 'dexaBodyFat', source: 'dexa', metric: 'Body Fat %', label: 'DEXA Body Fat %', color: METHOD_COLORS.dexa },
      { key: 'scaleBodyFat', source: 'scale', metric: 'Scale Body Fat %', label: 'Wyze Body Fat %', color: METHOD_COLORS.scale },
    ],
  },
  {
    id: 'leanMass',
    label: 'Lean Mass',
    unit: 'lb',
    note: 'DEXA lean mass compared with Wyze lean body mass and muscle mass estimates.',
    series: [
      { key: 'dexaLeanMass', source: 'dexa', metric: 'Lean Mass', label: 'DEXA Lean Mass', color: METHOD_COLORS.dexa },
      { key: 'scaleLeanBodyMass', source: 'scale', metric: 'Lean Body Mass', label: 'Wyze Lean Body Mass', color: METHOD_COLORS.scale },
      { key: 'scaleMuscleMass', source: 'scale', metric: 'Muscle Mass', label: 'Wyze Muscle Mass', color: '#c56b1a', strokeDasharray: '6 4' },
    ],
  },
  {
    id: 'fatMass',
    label: 'Fat Mass',
    unit: 'lb',
    note: 'DEXA fat mass compared with Wyze fat-content estimate.',
    series: [
      { key: 'dexaFatMass', source: 'dexa', metric: 'Fat Mass', label: 'DEXA Fat Mass', color: METHOD_COLORS.dexa },
      { key: 'scaleFatContent', source: 'scale', metric: 'Fat Content', label: 'Wyze Fat Content', color: METHOD_COLORS.scale },
    ],
  },
  {
    id: 'boneMass',
    label: 'Bone Mass',
    unit: 'lb',
    note: 'DEXA bone mass compared with Wyze bone mass estimate.',
    series: [
      { key: 'dexaBoneMass', source: 'dexa', metric: 'Bone Mass', label: 'DEXA Bone Mass', color: METHOD_COLORS.dexa },
      { key: 'scaleBoneMass', source: 'scale', metric: 'Scale Bone Mass', label: 'Wyze Bone Mass', color: METHOD_COLORS.scale },
    ],
  },
  {
    id: 'metabolism',
    label: 'RMR / BMR',
    unit: 'kcal/day',
    note: 'DEXA-derived RMR formulas compared with Wyze BMR estimate.',
    series: [
      { key: 'dexaRmrCunningham', source: 'dexa', metric: 'RMR Cunningham', label: 'DEXA RMR Cunningham', color: METHOD_COLORS.dexa },
      { key: 'dexaRmrMifflin', source: 'dexa', metric: 'RMR Mifflin St Jeor', label: 'DEXA RMR Mifflin', color: '#2fa79c', strokeDasharray: '5 4' },
      { key: 'scaleBmr', source: 'scale', metric: 'BMR', label: 'Wyze BMR', color: METHOD_COLORS.scale },
    ],
  },
  {
    id: 'visceral',
    label: 'Visceral Indicators',
    unit: 'mixed',
    note: 'DEXA VAT mass and Wyze visceral-fat score are different units, so compare direction and timing rather than absolute equality.',
    series: [
      { key: 'dexaVatMass', source: 'dexa', metric: 'VAT Mass', label: 'DEXA VAT Mass lb', color: METHOD_COLORS.dexa },
      { key: 'scaleVisceralFat', source: 'scale', metric: 'Scale Visceral Fat', label: 'Wyze Visceral Score', color: METHOD_COLORS.scale },
    ],
  },
];

const OVERVIEW_CARDS = [
  {
    title: 'Weight',
    sourceLabel: 'Scale + DEXA',
    source: 'scale',
    metric: 'Weight',
    compareSource: 'dexa',
    compareMetric: 'DEXA Weight',
  },
  {
    title: 'Body Fat',
    sourceLabel: 'DEXA + Scale',
    source: 'dexa',
    metric: 'Body Fat %',
    compareSource: 'scale',
    compareMetric: 'Scale Body Fat %',
  },
  {
    title: 'Lean Mass',
    sourceLabel: 'DEXA + Scale',
    source: 'dexa',
    metric: 'Lean Mass',
    compareSource: 'scale',
    compareMetric: 'Lean Body Mass',
  },
  {
    title: 'Fat Mass',
    sourceLabel: 'DEXA + Scale',
    source: 'dexa',
    metric: 'Fat Mass',
    compareSource: 'scale',
    compareMetric: 'Fat Content',
  },
  {
    title: 'Visceral',
    sourceLabel: 'DEXA + Scale',
    source: 'dexa',
    metric: 'VAT Mass',
    compareSource: 'scale',
    compareMetric: 'Scale Visceral Fat',
  },
  {
    title: 'Fasting Glucose',
    sourceLabel: 'Daily morning',
    source: 'glucose',
    metric: FASTING_GLUCOSE_METRIC,
  },
  {
    title: 'Bedtime Glucose',
    sourceLabel: 'Daily evening',
    source: 'glucose',
    metric: BEDTIME_GLUCOSE_METRIC,
  },
  {
    title: 'ApoB',
    sourceLabel: 'Bloodwork',
    source: 'labs',
    metric: 'ApoB',
  },
  {
    title: 'HDL',
    sourceLabel: 'Bloodwork',
    source: 'labs',
    metric: 'HDL Cholesterol',
  },
  {
    title: 'Triglycerides',
    sourceLabel: 'Bloodwork',
    source: 'labs',
    metric: 'Triglycerides',
  },
  {
    title: 'hs-CRP',
    sourceLabel: 'Bloodwork',
    source: 'labs',
    metric: 'hs-CRP (High-Sensitivity C-Reactive Protein)',
  },
  {
    title: 'Vitamin D',
    sourceLabel: 'Bloodwork',
    source: 'labs',
    metric: 'Vitamin D',
  },
  {
    title: 'Testosterone',
    sourceLabel: 'Bloodwork',
    source: 'labs',
    metric: 'Total Testosterone',
  },
  {
    title: 'Ferritin',
    sourceLabel: 'Bloodwork',
    source: 'labs',
    metric: 'Ferritin',
  },
];

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
  if (pair) {
    return { low: Number(pair[1]), high: Number(pair[2]) };
  }
  const lessThan = text.match(/<\s*(-?\d+(?:\.\d+)?)/);
  if (lessThan) return { high: Number(lessThan[1]) };
  const greaterThan = text.match(/>\s*(-?\d+(?:\.\d+)?)/);
  if (greaterThan) return { low: Number(greaterThan[1]) };
  return {};
}

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function normalizeDate(row) {
  const dateValue = row.time
    || row.date
    || row.Date
    || row['Date and Time']
    || row.scan_date
    || row.result_date
    || row.start_time
    || row.acquire_time
    || row.timestamp
    || row.Timestamp;
  if (!dateValue) return null;
  if (dateValue instanceof Date && !Number.isNaN(dateValue.getTime())) {
    return dateValue.toISOString().slice(0, 10);
  }
  const date = new Date(String(dateValue).trim());
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  const wyzeDate = String(dateValue).trim().match(/^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (wyzeDate) {
    const [, year, month, day, hour, minute, meridiem] = wyzeDate;
    const hour24 = (Number(hour) % 12) + (meridiem.toUpperCase() === 'PM' ? 12 : 0);
    const parsed = new Date(Number(year), Number(month) - 1, Number(day), hour24, Number(minute));
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }
  return null;
}

function rowHash(record) {
  if (record.source === 'glucose') {
    return [
      record.source,
      record.date,
      record.metric,
      record.unit || '',
    ].join('|');
  }
  return [
    record.source,
    record.date,
    record.metric,
    record.value,
    record.unit || '',
    record.rawValue || '',
  ].join('|');
}

function createRecordId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const random = globalThis.crypto?.getRandomValues
    ? Array.from(globalThis.crypto.getRandomValues(new Uint32Array(2)), (value) => value.toString(16)).join('')
    : Math.random().toString(36).slice(2);
  return `record-${Date.now().toString(36)}-${random}`;
}

function normalizeLabRow(row) {
  const date = normalizeDate(row);
  const metric = row.marker || row.Marker || row.test || row.Test;
  const parsed = parseNumber(row.value ?? row.Value ?? row.result ?? row.Result);
  if (!date || !metric || !parsed) return null;
  const range = parseRange(row.reference_range || row.referenceRange || row.range);
  return {
    id: createRecordId(),
    source: 'labs',
    date,
    metric: String(metric).trim(),
    value: parsed.value,
    rawValue: parsed.raw,
    comparator: parsed.comparator,
    unit: row.unit || row.Unit || '',
    status: row.status || row.Status || '',
    referenceRange: row.reference_range || row.referenceRange || row.range || '',
    low: range.low,
    high: range.high,
  };
}

function normalizeDexaRows(row) {
  const date = normalizeDate(row);
  if (!date) return [];
  const bodySpecRows = normalizeBodySpecDexaRows(row);
  if (bodySpecRows.length) return bodySpecRows;
  if (row.metric && row.value !== undefined) {
    const parsed = parseNumber(row.value);
    if (!parsed) return [];
    return [{
      id: createRecordId(),
      source: 'dexa',
      date,
      metric: String(row.metric).trim(),
      value: parsed.value,
      rawValue: parsed.raw,
      unit: row.unit || '',
    }];
  }
  const metrics = [
    ['body_fat_pct', 'Body Fat %', '%'],
    ['lean_mass_lbs', 'Lean Mass', 'lb'],
    ['lean_mass_lb', 'Lean Mass', 'lb'],
    ['fat_mass_lbs', 'Fat Mass', 'lb'],
    ['fat_mass_lb', 'Fat Mass', 'lb'],
    ['bone_mass_lbs', 'Bone Mass', 'lb'],
    ['bone_mass_lb', 'Bone Mass', 'lb'],
    ['visceral_fat', 'Visceral Fat', ''],
    ['android_gynoid_ratio', 'Android/Gynoid Ratio', ''],
    ['total_mass_lbs', 'Total Mass', 'lb'],
    ['total_mass_lb', 'Total Mass', 'lb'],
  ];
  return metrics.flatMap(([key, label, unit]) => {
    const parsed = parseNumber(row[key] ?? row[camelize(key)]);
    if (!parsed) return [];
    return [{
      id: createRecordId(),
      source: 'dexa',
      date,
      metric: label,
      value: parsed.value,
      rawValue: parsed.raw,
      unit,
    }];
  });
}

function normalizeBodySpecDexaRows(row) {
  const date = normalizeDate(row);
  const resultId = row.result_id || '';
  const importer = 'bodyspec';
  const hasMasterColumns = !row.region && (
    row.body_fat_pct !== undefined
    || row.weight_lb !== undefined
    || row.fat_free_mass_lb !== undefined
    || row.bone_mineral_density_g_cm2 !== undefined
  );
  const hasRegionColumns = row.region && (
    row.fat_mass_lb !== undefined
    || row.lean_mass_lb !== undefined
    || row.bone_mineral_density_g_cm2 !== undefined
  );
  const hasRmrColumns = row.formula && row.kcal_per_day !== undefined;
  const hasVisceralColumns = row.vat_mass_kg !== undefined || row.vat_volume_cm3 !== undefined;
  const records = [];

  if (hasMasterColumns) {
    [
      ['weight_lb', 'DEXA Weight', 'lb'],
      ['bmi', 'DEXA BMI', ''],
      ['body_fat_pct', 'Body Fat %', '%'],
      ['tissue_fat_pct', 'Tissue Fat %', '%'],
      ['region_fat_pct', 'Region Fat %', '%'],
      ['fat_mass_lb', 'Fat Mass', 'lb'],
      ['lean_mass_lb', 'Lean Mass', 'lb'],
      ['bone_mass_lb', 'Bone Mass', 'lb'],
      ['fat_free_mass_lb', 'Fat-Free Mass', 'lb'],
      ['fmi_kg_m2', 'FMI', 'kg/m2'],
      ['lmi_kg_m2', 'LMI', 'kg/m2'],
      ['ffmi_kg_m2', 'FFMI', 'kg/m2'],
      ['lean_to_fat_ratio', 'Lean-to-Fat Ratio', ''],
      ['android_gynoid_ratio', 'Android/Gynoid Ratio', ''],
      ['vat_mass_lb', 'VAT Mass', 'lb'],
      ['vat_volume_cm3', 'VAT Volume', 'cm3'],
      ['bone_mineral_density_g_cm2', 'Bone Mineral Density', 'g/cm2'],
      ['bone_area_cm2', 'Bone Area', 'cm2'],
      ['bone_mineral_content_g', 'Bone Mineral Content', 'g'],
      ['body_fat_percentile', 'Body Fat Percentile', 'percentile'],
      ['vat_percentile', 'VAT Percentile', 'percentile'],
      ['total_lmi_percentile', 'Total LMI Percentile', 'percentile'],
      ['limb_lmi_percentile', 'Limb LMI Percentile', 'percentile'],
      ['bone_density_percentile', 'Bone Density Percentile', 'percentile'],
      ['rmr_ten_haaf_kcal_day', 'RMR Ten Haaf', 'kcal/day'],
      ['rmr_cunningham_kcal_day', 'RMR Cunningham', 'kcal/day'],
      ['rmr_de_lorenzo_kcal_day', 'RMR De Lorenzo', 'kcal/day'],
      ['rmr_mifflin_st_jeor_kcal_day', 'RMR Mifflin St Jeor', 'kcal/day'],
      ['days_since_previous', 'Days Since Previous DEXA', 'days'],
      ['weight_change_lb', 'Weight Change Since Previous DEXA', 'lb'],
      ['fat_mass_change_lb', 'Fat Mass Change Since Previous DEXA', 'lb'],
      ['lean_mass_change_lb', 'Lean Mass Change Since Previous DEXA', 'lb'],
      ['body_fat_pct_change', 'Body Fat % Change Since Previous DEXA', 'pct points'],
      ['vat_mass_change_lb', 'VAT Mass Change Since Previous DEXA', 'lb'],
      ['fat_loss_rate_lb_per_week', 'Fat Loss Rate', 'lb/week'],
      ['lean_change_rate_lb_per_week', 'Lean Change Rate', 'lb/week'],
      ['pct_weight_change_from_fat', 'Weight Change From Fat', '%'],
      ['estimated_daily_calorie_deficit', 'Estimated Daily Calorie Deficit', 'kcal/day'],
    ].forEach(([key, label, unit]) => pushMetric(records, row, key, label, unit, date, resultId, importer));
  }

  if (hasRegionColumns) {
    const region = titleize(row.region);
    [
      ['fat_mass_lb', `${region} Fat Mass`, 'lb'],
      ['lean_mass_lb', `${region} Lean Mass`, 'lb'],
      ['bone_mass_lb', `${region} Bone Mass`, 'lb'],
      ['total_mass_lb', `${region} Total Mass`, 'lb'],
      ['tissue_fat_pct', `${region} Tissue Fat %`, '%'],
      ['region_fat_pct', `${region} Region Fat %`, '%'],
      ['bone_mineral_density_g_cm2', `${region} Bone Mineral Density`, 'g/cm2'],
      ['bone_area_cm2', `${region} Bone Area`, 'cm2'],
      ['bone_mineral_content_g', `${region} Bone Mineral Content`, 'g'],
      ['age_sex_z_percentile', `${region} Age/Sex Z Percentile`, 'percentile'],
      ['peak_sex_t_percentile', `${region} Peak/Sex T Percentile`, 'percentile'],
    ].forEach(([key, label, unit]) => pushMetric(records, row, key, label, unit, date, resultId, importer));
  }

  if (row.metric && row.percentile !== undefined) {
    const label = titleize(row.metric);
    pushMetric(records, row, 'value', `${label} Value`, '', date, resultId, importer);
    pushMetric(records, row, 'percentile', `${label} Percentile`, 'percentile', date, resultId, importer);
  }

  if (hasRmrColumns) {
    pushMetric(records, row, 'kcal_per_day', `RMR ${row.formula}`, 'kcal/day', date, resultId, importer);
  }

  if (hasVisceralColumns) {
    pushMetric(records, row, 'vat_mass_kg', 'VAT Mass', 'kg', date, resultId, importer);
    pushMetric(records, row, 'vat_volume_cm3', 'VAT Volume', 'cm3', date, resultId, importer);
  }

  return records;
}

function pushMetric(records, row, key, label, unit, date, externalId, importer) {
  const parsed = parseNumber(row[key]);
  if (!parsed) return;
  records.push({
    id: createRecordId(),
    source: 'dexa',
    date,
    metric: label,
    value: parsed.value,
    rawValue: parsed.raw,
    comparator: parsed.comparator,
    unit,
    externalId,
    importer,
  });
}

function titleize(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeScaleRows(row) {
  const date = normalizeDate(row);
  if (!date) return [];
  const metrics = [
    ['Weight', 'lb', ['weight_lbs', 'weight_lb', 'Weight(lb)', 'Weight']],
    ['Weight kg', 'kg', ['weight_kg', 'Weight(kg)']],
    ['BMI', '', ['bmi', 'BMI']],
    ['Scale Body Fat %', '%', ['body_fat_pct', 'Body Fat']],
    ['Muscle Mass', 'lb', ['muscle_mass_lbs', 'muscle_mass_lb', 'Muscle Mass']],
    ['Muscle Mass %', '%', ['muscle_mass_pct', 'Muscle Mass %']],
    ['Water %', '%', ['water_pct', 'Body Water']],
    ['Lean Body Mass', 'lb', ['lean_body_mass_lbs', 'lean_body_mass_lb', 'Lean Body Mass']],
    ['Scale Bone Mass', 'lb', ['bone_mass_lbs', 'bone_mass_lb', 'Bone Mass']],
    ['Protein %', '%', ['protein_pct', 'Protein']],
    ['Scale Visceral Fat', '', ['visceral_fat', 'Visceral Fat']],
    ['BMR', 'kcal/day', ['bmr', 'BMR']],
    ['Metabolic Age', 'years', ['metabolic_age', 'Metabolic Age']],
    ['Skeletal Muscle', 'lb', ['skeletal_muscle_lbs', 'Skeletal Muscle']],
    ['Skeletal Muscle Rate %', '%', ['skeletal_muscle_rate_pct', 'Skeletal Muscle Rate %']],
    ['Fat Content', 'lb', ['fat_content_lbs', 'Fat Content']],
    ['Subcutaneous Fat %', '%', ['subcutaneous_fat_pct', 'Subcutaneous Fat']],
  ];
  return metrics.flatMap(([label, unit, aliases]) => {
    const candidates = aliases.flatMap((key) => [key, camelize(key), key.toLowerCase()]);
    const raw = candidates.map((candidate) => row[candidate]).find((value) => value !== undefined && value !== '');
    const parsed = parseNumber(raw);
    if (!parsed) return [];
    return [{
      id: createRecordId(),
      source: 'scale',
      date,
      metric: label,
      value: parsed.value,
      rawValue: parsed.raw,
      unit,
    }];
  });
}

function parseWorkbookRows(rows) {
  const headerIndex = rows.findIndex((row) => Array.isArray(row) && row.some((cell) => String(cell).trim() === 'Date and Time'));
  if (headerIndex < 0) {
    throw new Error('Could not find the Wyze "Date and Time" header row.');
  }
  const headers = rows[headerIndex].map((cell) => String(cell).trim());
  return rows.slice(headerIndex + 1).flatMap((row) => {
    const record = {};
    headers.forEach((header, index) => {
      if (header) record[header] = row[index];
    });
    return record['Date and Time'] ? [record] : [];
  });
}

async function parseWyzeWorkbookRows(file) {
  const archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const sheet = archive['xl/worksheets/sheet1.xml'];
  if (!sheet) throw new Error('Could not find xl/worksheets/sheet1.xml inside the workbook.');
  const sharedStrings = archive['xl/sharedStrings.xml']
    ? parseSharedStringsXml(strFromU8(archive['xl/sharedStrings.xml']))
    : [];
  const rows = parseSheetXml(strFromU8(sheet), sharedStrings);
  return parseWorkbookRows(rows);
}

function parseSharedStringsXml(xml) {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((siMatch) => {
    return [...siMatch[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
      .map((textMatch) => decodeXml(textMatch[1]))
      .join('');
  });
}

function parseSheetXml(xml, sharedStrings) {
  return [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((rowMatch) => {
    const row = [];
    [...rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)].forEach((cellMatch) => {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const ref = attrs.match(/\br="([^"]+)"/)?.[1] || '';
      const type = attrs.match(/\bt="([^"]+)"/)?.[1];
      const column = columnIndex(ref);
      const valueText = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] || '';
      let value = '';
      if (type === 'inlineStr') {
        value = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
          .map((textMatch) => decodeXml(textMatch[1]))
          .join('');
      } else if (type === 's') {
        value = sharedStrings[Number(valueText || 0)] || '';
      } else {
        value = decodeXml(valueText);
      }
      row[column] = value;
    });
    return row;
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

function normalizeWarehouseRecord(row) {
  const source = inferWarehouseSource(row);
  const date = normalizeDate(row);
  const metric = row.metric || row.marker || row.Marker || row.test || row.Test || row.measurement || row.name;
  const parsed = parseNumber(row.value ?? row.Value ?? row.result ?? row.Result ?? row.measurement_value);
  if (!source || !date || !metric || !parsed) return null;
  const range = parseRange(row.reference_range || row.referenceRange || row.range);
  return {
    id: createRecordId(),
    source,
    date,
    metric: String(metric).trim(),
    value: parsed.value,
    rawValue: parsed.raw,
    comparator: parsed.comparator,
    unit: row.unit || (source === 'glucose' ? 'mg/dL' : ''),
    status: row.status || '',
    referenceRange: row.reference_range || row.referenceRange || row.range || '',
    low: row.low ?? range.low,
    high: row.high ?? range.high,
    externalId: row.id || row.external_id || '',
    importer: row.importer || row.provider || '',
  };
}

function inferWarehouseSource(row) {
  const explicit = normalizeSource(row.source || row.kind || row.domain || row.category);
  if (explicit) return explicit;

  const metric = normalizeKey(row.metric || row.measurement || row.name || '');
  if (GLUCOSE_SOURCE_ALIASES.includes(metric)) return 'glucose';

  const hasLabMetric = Boolean(row.marker || row.Marker || row.test || row.Test);
  const hasLabValue = row.value !== undefined || row.Value !== undefined || row.result !== undefined || row.Result !== undefined;
  if (hasLabMetric && hasLabValue) return 'labs';

  return null;
}

function normalizeSource(source) {
  const normalized = normalizeKey(source);
  if (['bloodwork', 'blood', 'lab', 'labs', 'rhythm'].includes(normalized)) return 'labs';
  if (['dexa', 'dexascan', 'body_spec', 'bodyspec', 'bodycomposition'].includes(normalized)) return 'dexa';
  if (['scale', 'wyze', 'weight', 'body_scan'].includes(normalized)) return 'scale';
  if (GLUCOSE_SOURCE_ALIASES.includes(normalized)) return 'glucose';
  return SOURCE_META[normalized] ? normalized : null;
}

function extractWarehouseRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.records)) return payload.records;
  if (Array.isArray(payload.measurements)) return payload.measurements;
  if (Array.isArray(payload.data)) return payload.data;
  return [];
}

function camelize(key) {
  return key.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
}

function dedupeRecords(existing, incoming) {
  const seen = new Set(existing.map(rowHash));
  const fresh = [];
  incoming.forEach((record) => {
    const hash = rowHash(record);
    if (!seen.has(hash)) {
      seen.add(hash);
      fresh.push(record);
    }
  });
  return [...existing, ...fresh].sort((a, b) => a.date.localeCompare(b.date) || a.metric.localeCompare(b.metric));
}

function summarizeTrend(records) {
  if (records.length < 2) return null;
  const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const delta = last.value - first.value;
  const pct = first.value ? (delta / first.value) * 100 : null;
  const days = Math.max(1, (new Date(last.date) - new Date(first.date)) / 86400000);
  const monthly = delta / days * 30.44;
  return { first, last, delta, pct, monthly, direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat' };
}

function recordsForSeries(records, series) {
  return (records[series.source] || [])
    .filter((record) => record.metric === series.metric)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function dailyAverages(records) {
  const grouped = new Map();
  records.forEach((record) => {
    if (!grouped.has(record.date)) grouped.set(record.date, []);
    grouped.get(record.date).push(record.value);
  });
  return [...grouped.entries()].map(([date, values]) => ({
    date,
    value: values.reduce((sum, value) => sum + value, 0) / values.length,
  }));
}

function latestRecord(records, source, metric) {
  const sourceRecords = (records[source] || []).filter((record) => record.metric === metric);
  if (!sourceRecords.length) return null;
  if (source === 'scale') {
    const latestDaily = dailyAverages(sourceRecords).sort((a, b) => a.date.localeCompare(b.date)).at(-1);
    const sample = sourceRecords.find((record) => record.date === latestDaily.date) || sourceRecords.at(-1);
    return {
      ...sample,
      value: latestDaily.value,
      rawValue: null,
    };
  }
  return [...sourceRecords].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
}

function formatRecord(record) {
  if (!record) return 'No data';
  const value = record.rawValue || formatValue(record.value);
  return `${value}${record.unit ? ` ${record.unit}` : ''}`;
}

function sourceName(source) {
  if (source === 'dexa') return 'DEXA';
  if (source === 'scale') return 'Wyze';
  if (source === 'labs') return 'Lab';
  if (source === 'glucose') return 'Glucose';
  return source;
}

function todayDateString() {
  const today = new Date();
  const local = new Date(today.getTime() - today.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function recordCount(grouped) {
  return Object.values(grouped).reduce((sum, rows) => sum + rows.length, 0);
}

function ensureRecordGroups(grouped) {
  return {
    labs: grouped?.labs || [],
    dexa: grouped?.dexa || [],
    scale: grouped?.scale || [],
    glucose: grouped?.glucose || [],
  };
}

function readLocalRecords() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? ensureRecordGroups(JSON.parse(stored)) : INITIAL_STATE;
  } catch {
    return INITIAL_STATE;
  }
}

async function fetchApiRecords() {
  const response = await fetch('/api/measurements');
  if (!response.ok) throw new Error('SQLite API is not available.');
  return ensureRecordGroups(await response.json());
}

async function postImport(source, fileName, records) {
  const response = await fetch('/api/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, fileName, records }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'Import failed.');
  }
  return response.json();
}

async function clearApiRecords() {
  const response = await fetch('/api/measurements', { method: 'DELETE' });
  if (!response.ok) throw new Error('Could not clear SQLite records.');
  return response.json();
}

async function fetchSession() {
  const response = await fetch('/api/auth/session');
  if (!response.ok) throw new Error('Could not check your session.');
  return response.json();
}

async function signIn(email, password) {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Could not sign in.');
  return body;
}

async function signOut() {
  await fetch('/api/auth/logout', { method: 'POST' });
}

async function fetchPeptideDoses() {
  const response = await fetch('/api/peptides/doses');
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'Could not load peptide doses.');
  }
  return response.json();
}

function buildComparisonData(records, config) {
  const byDate = new Map();
  config.series.forEach((series) => {
    dailyAverages(recordsForSeries(records, series)).forEach((point) => {
      if (!byDate.has(point.date)) byDate.set(point.date, { date: point.date });
      byDate.get(point.date)[series.key] = Number(point.value.toFixed(3));
    });
  });
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function latestNearestComparison(records, config) {
  const primary = config.series.find((series) => series.source === 'dexa');
  const secondary = config.series.find((series) => series.source === 'scale');
  if (!primary || !secondary || config.unit === 'mixed') return null;

  const primaryRecords = dailyAverages(recordsForSeries(records, primary));
  const secondaryRecords = dailyAverages(recordsForSeries(records, secondary));
  const latestPrimary = primaryRecords.at(-1);
  if (!latestPrimary || !secondaryRecords.length) return null;

  const primaryTime = new Date(`${latestPrimary.date}T00:00:00`).getTime();
  const nearest = secondaryRecords.reduce((best, point) => {
    const days = Math.abs((new Date(`${point.date}T00:00:00`).getTime() - primaryTime) / 86400000);
    if (!best || days < best.days) return { ...point, days };
    return best;
  }, null);

  if (!nearest || nearest.days > 14) return null;
  const delta = nearest.value - latestPrimary.value;
  const pct = latestPrimary.value ? (delta / latestPrimary.value) * 100 : null;
  return {
    primary,
    secondary,
    primaryPoint: latestPrimary,
    secondaryPoint: nearest,
    delta,
    pct,
  };
}

function completedDoses(doses) {
  return doses.filter((dose) => dose.status === 'completed');
}

function peptideSummary(doses) {
  const completed = completedDoses(doses);
  const byPeptide = new Map();
  completed.forEach((dose) => {
    const key = `${dose.peptideName}|${dose.doseUnit}`;
    const current = byPeptide.get(key) || {
      peptideName: dose.peptideName,
      doseUnit: dose.doseUnit,
      doses: 0,
      total: 0,
      dates: new Set(),
    };
    current.doses += 1;
    current.total += Number(dose.actualDoseAmount) || 0;
    current.dates.add(dose.date);
    byPeptide.set(key, current);
  });
  return [...byPeptide.values()]
    .map((item) => ({ ...item, activeDays: item.dates.size }))
    .sort((a, b) => b.doses - a.doses || a.peptideName.localeCompare(b.peptideName));
}

function dateOffset(date, days) {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
}

function pearsonCorrelation(points) {
  if (points.length < 8) return null;
  const xMean = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const yMean = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  let numerator = 0;
  let xSquared = 0;
  let ySquared = 0;
  points.forEach(({ x, y }) => {
    const xDiff = x - xMean;
    const yDiff = y - yMean;
    numerator += xDiff * yDiff;
    xSquared += xDiff ** 2;
    ySquared += yDiff ** 2;
  });
  if (!xSquared || !ySquared) return null;
  return numerator / Math.sqrt(xSquared * ySquared);
}

function peptideHealthCorrelations(records, doses) {
  const activeDates = new Set(completedDoses(doses).map((dose) => dose.date));
  const metrics = [
    { label: 'Weight', source: 'scale', metric: 'Weight', unit: 'lb' },
    { label: 'Body Fat', source: 'scale', metric: 'Scale Body Fat %', unit: '%' },
    { label: 'Lean Body Mass', source: 'scale', metric: 'Lean Body Mass', unit: 'lb' },
    { label: 'Fasting Glucose', source: 'glucose', metric: FASTING_GLUCOSE_METRIC, unit: 'mg/dL' },
    { label: 'Bedtime Glucose', source: 'glucose', metric: BEDTIME_GLUCOSE_METRIC, unit: 'mg/dL' },
  ];
  return metrics.map((metric) => {
    const points = dailyAverages(recordsForSeries(records, metric)).map((point) => {
      let injections = 0;
      for (let offset = 0; offset < 7; offset += 1) {
        if (activeDates.has(dateOffset(point.date, -offset))) injections += 1;
      }
      return { x: injections, y: point.value };
    });
    return { ...metric, n: points.length, correlation: pearsonCorrelation(points) };
  });
}

function correlationLabel(value) {
  if (!Number.isFinite(value)) return 'Not enough varied overlap';
  const direction = value > 0 ? 'positive' : value < 0 ? 'negative' : 'no clear';
  const strength = Math.abs(value) >= 0.7 ? 'strong' : Math.abs(value) >= 0.4 ? 'moderate' : 'weak';
  return `${strength} ${direction}`;
}

function App() {
  const [records, setRecords] = useState(INITIAL_STATE);
  const [authStatus, setAuthStatus] = useState('loading');
  const [authUser, setAuthUser] = useState(null);
  const [loginError, setLoginError] = useState('');
  const [storageMode, setStorageMode] = useState('loading');
  const [activeSource, setActiveSource] = useState('labs');
  const [selectedMetric, setSelectedMetric] = useState('');
  const [selectedComparison, setSelectedComparison] = useState(COMPARISON_METRICS[1].id);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [glucoseDate, setGlucoseDate] = useState(todayDateString());
  const [fastingGlucoseValue, setFastingGlucoseValue] = useState('');
  const [bedtimeGlucoseValue, setBedtimeGlucoseValue] = useState('');
  const [peptideConnection, setPeptideConnection] = useState('loading');
  const [peptideData, setPeptideData] = useState({ user: null, doses: [] });
  const [peptideError, setPeptideError] = useState('');
  const [reportOpen, setReportOpen] = useState(false);
  const fileRefs = {
    labs: useRef(null),
    dexa: useRef(null),
    scale: useRef(null),
    warehouse: useRef(null),
  };

  useEffect(() => {
    let cancelled = false;
    fetchSession()
      .then((result) => {
        if (cancelled) return;
        setAuthUser(result.user || null);
        setAuthStatus(result.authenticated ? 'authenticated' : 'anonymous');
      })
      .catch(() => {
        if (!cancelled) setAuthStatus('anonymous');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (authStatus !== 'authenticated') return undefined;
    let cancelled = false;
    async function loadRecords() {
      try {
        const apiRecords = await fetchApiRecords();
        if (cancelled) return;
        const localRecords = readLocalRecords();
        if (recordCount(apiRecords) === 0 && recordCount(localRecords) > 0) {
          let latest = apiRecords;
          for (const source of DATA_SOURCES) {
            if (localRecords[source]?.length) {
              const result = await postImport(source, 'localStorage migration', localRecords[source]);
              latest = result.records;
            }
          }
          if (!cancelled) {
            setRecords(latest);
            setStorageMode('sqlite');
            setMessage(`Migrated ${recordCount(localRecords)} browser-stored data points into SQLite.`);
          }
          return;
        }
        setRecords(apiRecords);
        setStorageMode('sqlite');
      } catch {
        if (cancelled) return;
        setRecords(readLocalRecords());
        setStorageMode('browser');
        setMessage('SQLite API unavailable. Using browser storage fallback.');
      }
    }
    loadRecords();
    return () => {
      cancelled = true;
    };
  }, [authStatus]);

  useEffect(() => {
    if (authStatus !== 'authenticated') return undefined;
    let cancelled = false;
    setPeptideConnection('loading-doses');
    fetchPeptideDoses()
      .then((result) => {
        if (cancelled) return;
        setPeptideData({ user: result.user, doses: result.doses || [] });
        setPeptideConnection('connected');
        setPeptideError('');
      })
      .catch((error) => {
        if (cancelled) return;
        setPeptideConnection('unavailable');
        setPeptideError(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [authStatus]);

  useEffect(() => {
    if (storageMode === 'browser') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    }
  }, [records, storageMode]);

  const allRecords = useMemo(() => Object.values(records).flat(), [records]);
  const activeRecords = records[activeSource] || [];
  const metricOptions = useMemo(() => {
    return [...new Set(activeRecords.map((record) => record.metric))]
      .filter((metric) => metric.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => a.localeCompare(b));
  }, [activeRecords, query]);

  useEffect(() => {
    if (!metricOptions.includes(selectedMetric)) {
      setSelectedMetric(metricOptions[0] || '');
    }
  }, [metricOptions, selectedMetric]);

  const selectedRecords = useMemo(() => {
    return activeRecords
      .filter((record) => record.metric === selectedMetric)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [activeRecords, selectedMetric]);

  const trend = summarizeTrend(selectedRecords);
  const comparisonConfig = COMPARISON_METRICS.find((metric) => metric.id === selectedComparison) || COMPARISON_METRICS[0];
  const comparisonData = useMemo(() => {
    return buildComparisonData(records, comparisonConfig);
  }, [records, comparisonConfig]);
  const comparisonGap = useMemo(() => {
    return latestNearestComparison(records, comparisonConfig);
  }, [records, comparisonConfig]);
  const comparisonSeriesCounts = useMemo(() => {
    return comparisonConfig.series.map((series) => ({
      ...series,
      count: new Set(recordsForSeries(records, series).map((record) => record.date)).size,
    }));
  }, [records, comparisonConfig]);
  const flaggedLabs = useMemo(() => {
    return records.labs
      .filter((record) => record.status && !['optimal', 'average'].includes(record.status))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [records.labs]);
  const overviewCards = useMemo(() => {
    return OVERVIEW_CARDS.map((card) => {
      const primary = latestRecord(records, card.source, card.metric);
      const comparison = card.compareSource ? latestRecord(records, card.compareSource, card.compareMetric) : null;
      return {
        ...card,
        primary,
        comparison,
      };
    });
  }, [records]);
  const completedPeptideDoses = useMemo(() => completedDoses(peptideData.doses), [peptideData.doses]);
  const peptideTotals = useMemo(() => peptideSummary(peptideData.doses), [peptideData.doses]);
  const peptideCorrelations = useMemo(() => peptideHealthCorrelations(records, peptideData.doses), [records, peptideData.doses]);

  async function saveImport(source, fileName, normalized) {
    if (!normalized.length) {
      setMessage(`No recognized ${SOURCE_META[source].label.toLowerCase()} data points were found in ${fileName}. Check that the file matches the expected columns.`);
      return;
    }
    if (storageMode === 'loading') {
      setMessage('Storage is still connecting. Please retry the import in a moment.');
      return;
    }
    if (storageMode === 'sqlite') {
      try {
        const result = await postImport(source, fileName, normalized);
        setRecords(result.records);
        setActiveSource(source);
        setMessage(`Imported ${result.insertedCount} new ${SOURCE_META[source].label.toLowerCase()} data points into SQLite from ${fileName}. ${result.duplicateCount} duplicate${result.duplicateCount === 1 ? '' : 's'} skipped.`);
        return;
      } catch (error) {
        setStorageMode('browser');
        setMessage(`SQLite import failed: ${error.message}. Using browser storage fallback.`);
      }
    }

    setRecords((current) => ({
      ...current,
      [source]: dedupeRecords(current[source] || [], normalized),
    }));
    setActiveSource(source);
    setMessage(`Imported ${normalized.length} ${SOURCE_META[source].label.toLowerCase()} data points from ${fileName}.`);
  }

  async function saveGlucoseReadings(event) {
    event.preventDefault();
    const fasting = parseNumber(fastingGlucoseValue);
    const bedtime = parseNumber(bedtimeGlucoseValue);
    const readings = [
      fasting && {
        metric: FASTING_GLUCOSE_METRIC,
        parsed: fasting,
        externalId: `morning-glucose-${glucoseDate}`,
        measuredAt: `${glucoseDate}T00:00:00`,
      },
      bedtime && {
        metric: BEDTIME_GLUCOSE_METRIC,
        parsed: bedtime,
        externalId: `bedtime-glucose-${glucoseDate}`,
        measuredAt: `${glucoseDate}T23:59:00`,
      },
    ].filter(Boolean);
    if (!glucoseDate || !readings.length) {
      setMessage('Enter a date and at least one fasting or bedtime glucose value in mg/dL.');
      return;
    }
    if (readings.some(({ parsed }) => parsed.value < 20 || parsed.value > 600)) {
      setMessage('Glucose readings should be entered in mg/dL. Check the value before saving.');
      return;
    }

    await saveImport('glucose', 'manual daily glucose', readings.map(({ metric, parsed, externalId, measuredAt }) => ({
      id: createRecordId(),
      source: 'glucose',
      date: glucoseDate,
      metric,
      value: parsed.value,
      rawValue: parsed.raw,
      unit: 'mg/dL',
      importer: 'manual',
      provider: 'manual',
      externalId,
      measuredAt,
    })));
    setFastingGlucoseValue('');
    setBedtimeGlucoseValue('');
  }

  function importCsv(source, file) {
    if (!file) return;
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (source === 'scale' && ['xlsx', 'xls'].includes(extension)) {
      parseWyzeWorkbookRows(file).then(async (rows) => {
        const normalized = rows.flatMap(normalizeScaleRows);
        if (!rows.length) {
          throw new Error('No scale rows were found after the Wyze header.');
        }
        if (!normalized.length) {
          throw new Error(`Read ${rows.length} Wyze rows, but no numeric measurements were recognized.`);
        }
        await saveImport('scale', file.name, normalized);
      }).catch((error) => {
        setMessage(`Could not parse ${file.name}: ${error?.message || 'expected a Wyze scale Excel export.'}`);
      }).finally(() => {
        fileRefs[source].current.value = '';
      });
      return;
    }
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async ({ data, errors }) => {
        if (errors.length) {
          setMessage(`Could not fully parse ${file.name}. Check the CSV formatting.`);
          return;
        }
        const normalized = data.flatMap((row) => {
          if (source === 'labs') {
            const lab = normalizeLabRow(row);
            return lab ? [lab] : [];
          }
          if (source === 'dexa') return normalizeDexaRows(row);
          return normalizeScaleRows(row);
        });
        if (!normalized.length) {
          setMessage(`Could not import ${file.name}: read ${data.length} CSV row${data.length === 1 ? '' : 's'}, but none matched the expected ${SOURCE_META[source].label.toLowerCase()} columns.`);
          fileRefs[source].current.value = '';
          return;
        }
        await saveImport(source, file.name, normalized);
        fileRefs[source].current.value = '';
      },
    });
  }

  function importWarehouseFile(file) {
    if (!file) return;
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (extension === 'json') {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const payload = JSON.parse(reader.result);
          importWarehouseRows(extractWarehouseRows(payload), file.name);
        } catch {
          setMessage(`Could not parse ${file.name}. Expected JSON from the warehouse export.`);
        } finally {
          fileRefs.warehouse.current.value = '';
        }
      };
      reader.readAsText(file);
      return;
    }

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: ({ data, errors }) => {
        if (errors.length) {
          setMessage(`Could not fully parse ${file.name}. Check the warehouse CSV formatting.`);
          return;
        }
        importWarehouseRows(data, file.name);
        fileRefs.warehouse.current.value = '';
      },
    });
  }

  async function importWarehouseRows(rows, fileName) {
    const normalized = rows.map(normalizeWarehouseRecord).filter(Boolean);
    if (!normalized.length) {
      setMessage(`Could not import ${fileName}: read ${rows.length} row${rows.length === 1 ? '' : 's'}, but none included recognizable source/date/metric/value data.`);
      return;
    }
    const grouped = normalized.reduce((acc, record) => {
      acc[record.source].push(record);
      return acc;
    }, { labs: [], dexa: [], scale: [], glucose: [] });

    if (storageMode === 'sqlite') {
      try {
        let latest = records;
        let inserted = 0;
        let duplicates = 0;
        for (const source of DATA_SOURCES) {
          if (grouped[source].length) {
            const result = await postImport(source, fileName, grouped[source]);
            latest = result.records;
            inserted += result.insertedCount;
            duplicates += result.duplicateCount;
          }
        }
        setRecords(latest);
        const firstSource = Object.keys(grouped).find((source) => grouped[source].length);
        if (firstSource) setActiveSource(firstSource);
        setMessage(`Imported ${inserted} new warehouse data points into SQLite from ${fileName}. ${duplicates} duplicate${duplicates === 1 ? '' : 's'} skipped.`);
        return;
      } catch (error) {
        setStorageMode('browser');
        setMessage(`SQLite warehouse import failed: ${error.message}. Using browser storage fallback.`);
      }
    }

    setRecords((current) => ({
      labs: dedupeRecords(current.labs, grouped.labs),
      dexa: dedupeRecords(current.dexa, grouped.dexa),
      scale: dedupeRecords(current.scale, grouped.scale),
      glucose: dedupeRecords(current.glucose || [], grouped.glucose),
    }));

    const firstSource = Object.keys(grouped).find((source) => grouped[source].length);
    if (firstSource) setActiveSource(firstSource);
    setMessage(`Imported ${normalized.length} warehouse data points from ${fileName}.`);
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(records, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `health-tracker-export-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function resetData() {
    if (window.confirm('Clear all imported health data from this browser?')) {
      if (storageMode === 'sqlite') {
        try {
          const empty = await clearApiRecords();
          setRecords(empty);
          localStorage.removeItem(STORAGE_KEY);
          setMessage('All SQLite health data has been cleared.');
          return;
        } catch (error) {
          setMessage(`Could not clear SQLite data: ${error.message}`);
          return;
        }
      }
      setRecords(INITIAL_STATE);
      localStorage.removeItem(STORAGE_KEY);
      setMessage('All local browser health data has been cleared.');
    }
  }

  async function handleLogin(email, password) {
    setLoginError('');
    try {
      const result = await signIn(email, password);
      setAuthUser(result.user);
      setAuthStatus('authenticated');
    } catch (error) {
      setLoginError(error.message);
      throw error;
    }
  }

  async function handleLogout() {
    await signOut();
    setAuthUser(null);
    setAuthStatus('anonymous');
    setRecords(INITIAL_STATE);
    setPeptideData({ user: null, doses: [] });
    setPeptideConnection('loading');
    setReportOpen(false);
  }

  const statTiles = [
    { label: 'Lab markers', value: new Set(records.labs.map((r) => r.metric)).size, icon: FlaskConical },
    { label: 'DEXA metrics', value: new Set(records.dexa.map((r) => r.metric)).size, icon: ScanLine },
    { label: 'Scale readings', value: new Set(records.scale.map((r) => r.date)).size, icon: Scale },
    { label: 'Glucose readings', value: new Set(records.glucose.map((r) => r.date)).size, icon: Activity },
    { label: 'Flagged labs', value: flaggedLabs.length, icon: Activity },
  ];
  const storageLabel = storageMode === 'sqlite' ? 'SQLite connected' : storageMode === 'browser' ? 'Browser storage' : 'Connecting storage';
  const storageTitle = storageMode === 'sqlite'
    ? 'Imports are saved to the SQLite API.'
    : storageMode === 'browser'
      ? 'SQLite API is unavailable, so imports are stored in this browser.'
      : 'Checking the SQLite API before imports are enabled.';
  const importsDisabled = storageMode === 'loading';

  if (authStatus !== 'authenticated') {
    return <LoginScreen loading={authStatus === 'loading'} error={loginError} onLogin={handleLogin} />;
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Personal longitudinal dashboard</p>
          <h1>Health Tracker</h1>
        </div>
        <div className="top-actions">
          <span className={`storage-pill ${storageMode}`} title={storageTitle}>
            {storageMode === 'sqlite' ? <Database size={15} /> : <HardDrive size={15} />}
            {storageLabel}
          </span>
          <span className="version-pill" title="Installed Health Tracker version">{APP_VERSION}</span>
          <button className="secondary-button report-button" onClick={() => setReportOpen(true)}>
            <FileText size={17} />
            Health Report
          </button>
          <button className="icon-button" onClick={exportData} title="Export local data">
            <Download size={18} />
          </button>
          <button className="icon-button danger" onClick={resetData} title="Clear imported data">
            <RotateCcw size={18} />
          </button>
          <button className="icon-button" onClick={handleLogout} title={`Sign out ${authUser?.email || ''}`}>
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <section className="import-grid">
        {IMPORT_SOURCES.map((source) => {
          const meta = SOURCE_META[source];
          const Icon = meta.icon;
          return (
            <article className="import-card" key={source} style={{ '--accent': meta.color }}>
              <div className="import-card-header">
                <Icon size={22} />
                <div>
                  <h2>{meta.label}</h2>
                  <p>{meta.copy}</p>
                </div>
              </div>
              <p className="format-line">{meta.accepted}</p>
              <input
                ref={fileRefs[source]}
                type="file"
                accept={source === 'scale' ? '.csv,.xlsx,.xls,text/csv' : '.csv,text/csv'}
                onChange={(event) => importCsv(source, event.target.files[0])}
                hidden
              />
              <button className="primary-button" onClick={() => fileRefs[source].current.click()} disabled={importsDisabled}>
                <FileUp size={17} />
                Import CSV
              </button>
            </article>
          );
        })}
      </section>

      <section className="manual-entry">
        <div>
          <div className="import-card-header">
            <Activity size={22} />
            <div>
              <h2>Daily Glucose</h2>
              <p>Record wake-up fasting and bedtime blood sugar as daily mg/dL measurements.</p>
            </div>
          </div>
        </div>
        <form className="manual-form" onSubmit={saveGlucoseReadings}>
          <label>
            <span>Date</span>
            <input
              type="date"
              value={glucoseDate}
              onChange={(event) => setGlucoseDate(event.target.value)}
            />
          </label>
          <label>
            <span>Fasting mg/dL</span>
            <input
              type="number"
              inputMode="decimal"
              min="20"
              max="600"
              step="0.1"
              value={fastingGlucoseValue}
              onChange={(event) => setFastingGlucoseValue(event.target.value)}
              placeholder="95"
            />
          </label>
          <label>
            <span>Bedtime mg/dL</span>
            <input
              type="number"
              inputMode="decimal"
              min="20"
              max="600"
              step="0.1"
              value={bedtimeGlucoseValue}
              onChange={(event) => setBedtimeGlucoseValue(event.target.value)}
              placeholder="110"
            />
          </label>
          <button className="secondary-button glucose-button" type="submit" disabled={importsDisabled}>
            <Activity size={17} />
            Save Readings
          </button>
        </form>
      </section>

      <section className="warehouse-import">
        <div>
          <div className="import-card-header">
            <FolderSync size={22} />
            <div>
              <h2>Health Data Warehouse</h2>
              <p>Import normalized exports from your Python pipeline once `bodyspec.py`, `rhythm.py`, or `wyze.py` has pulled the raw data.</p>
            </div>
          </div>
          <p className="format-line">JSON or CSV records with source,date,metric,value,unit,status,reference_range</p>
        </div>
        <input
          ref={fileRefs.warehouse}
          type="file"
          accept=".json,.csv,application/json,text/csv"
          onChange={(event) => importWarehouseFile(event.target.files[0])}
          hidden
        />
        <button className="secondary-button" onClick={() => fileRefs.warehouse.current.click()} disabled={importsDisabled}>
          <FileUp size={17} />
          Import Warehouse Export
        </button>
      </section>

      {message && <div className="status-message"><Upload size={16} />{message}</div>}

      <section className="stats-grid">
        {statTiles.map((tile) => {
          const Icon = tile.icon;
          return (
            <div className="stat" key={tile.label}>
              <Icon size={18} />
              <span>{tile.label}</span>
              <strong>{tile.value}</strong>
            </div>
          );
        })}
      </section>

      <section className="peptide-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Read-only connection</p>
            <h2>Peptide Usage</h2>
          </div>
          <span className={`peptide-status ${peptideConnection}`}>
            <Syringe size={15} />
            {peptideConnection === 'connected' ? 'Connected' : peptideConnection === 'loading' || peptideConnection === 'loading-doses' ? 'Connecting' : 'Not connected'}
          </span>
        </div>
        <div className="peptide-controls">
          <div className="peptide-connection-copy">
            {peptideData.user
              ? `${peptideData.user.displayName} is matched from ${peptideData.user.email}. ${completedPeptideDoses.length} completed doses across ${new Set(completedPeptideDoses.map((dose) => dose.date)).size} injection day${new Set(completedPeptideDoses.map((dose) => dose.date)).size === 1 ? '' : 's'}.`
              : peptideError || 'Matching the signed-in Peptide Power profile.'}
          </div>
          <button className="secondary-button report-button" onClick={() => setReportOpen(true)} disabled={!peptideData.user}>
            <FileText size={17} />
            Generate Combined Report
          </button>
        </div>
      </section>

      {reportOpen && (
        <section className="health-report" id="health-report">
          <div className="report-toolbar">
            <div>
              <p className="eyebrow">On-demand summary</p>
              <h2>Health and Peptide Report</h2>
            </div>
            <div className="report-actions">
              <button className="secondary-button" onClick={() => window.print()}>
                <Printer size={17} />
                Print or Save PDF
              </button>
              <button className="icon-button" onClick={() => setReportOpen(false)} title="Close report">x</button>
            </div>
          </div>
          <p className="report-meta">Generated {new Date().toLocaleDateString()} · Health Tracker {APP_VERSION}{peptideData.user ? ` · Peptide profile: ${peptideData.user.displayName}` : ''}</p>
          <div className="report-grid">
            {overviewCards.slice(0, 8).map((card) => {
              const latest = latestRecord(records, card.source, card.metric);
              const trendForCard = summarizeTrend(recordsForSeries(records, card).filter((record) => record.unit === latest?.unit));
              return (
                <article className="report-metric" key={`report-${card.source}-${card.metric}`}>
                  <span>{card.title}</span>
                  <strong>{formatRecord(latest)}</strong>
                  <small>{trendForCard ? `${formatDelta(trendForCard.delta)} ${trendForCard.last.unit} since ${trendForCard.first.date}` : 'One reading or less'}</small>
                </article>
              );
            })}
          </div>
          <div className="report-columns">
            <div>
              <h3>Peptide Activity</h3>
              {peptideData.user ? (
                <table className="report-table">
                  <thead><tr><th>Peptide</th><th>Doses</th><th>Active days</th><th>Total</th></tr></thead>
                  <tbody>{peptideTotals.map((item) => <tr key={`${item.peptideName}-${item.doseUnit}`}><td>{item.peptideName}</td><td>{item.doses}</td><td>{item.activeDays}</td><td>{formatValue(item.total)} {item.doseUnit}</td></tr>)}</tbody>
                </table>
              ) : <p className="empty">The matching peptide profile is not available.</p>}
            </div>
            <div>
              <h3>Health Associations</h3>
              <p className="report-note">Exploratory only: Pearson correlation of each metric with the number of injection days in the preceding 7 days. It cannot show that peptides caused a change.</p>
              <table className="report-table">
                <thead><tr><th>Metric</th><th>Overlap</th><th>r</th><th>Signal</th></tr></thead>
                <tbody>{peptideCorrelations.map((item) => <tr key={item.metric}><td>{item.label}</td><td>{item.n}</td><td>{Number.isFinite(item.correlation) ? item.correlation.toFixed(2) : '—'}</td><td>{correlationLabel(item.correlation)}</td></tr>)}</tbody>
              </table>
            </div>
          </div>
          {flaggedLabs.length > 0 && <p className="report-note"><strong>Lab watchlist:</strong> {flaggedLabs.slice(0, 5).map((record) => `${record.metric} (${formatRecord(record)}, ${record.status})`).join('; ')}.</p>}
        </section>
      )}

      <section className="overview-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Single pane</p>
            <h2>Health Overview</h2>
          </div>
          <div className="overview-alert">
            <Activity size={16} />
            {flaggedLabs.length} lab watchlist item{flaggedLabs.length === 1 ? '' : 's'}
          </div>
        </div>

        <div className="overview-grid">
          {overviewCards.map((card) => (
            <article className="overview-card" key={`${card.source}-${card.metric}`}>
              <div className="overview-card-top">
                <span>{card.sourceLabel}</span>
                {card.primary?.status && (
                  <em className={`status ${normalizeKey(card.primary.status)}`}>
                    {card.primary.status}
                  </em>
                )}
              </div>
              <h3>{card.title}</h3>
              <strong>{formatRecord(card.primary)}</strong>
              <small>{card.primary ? `${sourceName(card.source)} on ${card.primary.date}` : 'Import data to populate'}</small>
              {card.comparison && (
                <div className="overview-compare">
                  <span>{sourceName(card.compareSource)}</span>
                  <b>{formatRecord(card.comparison)}</b>
                  <small>{card.comparison.date}</small>
                </div>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="comparison-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Method comparison</p>
            <h2>DEXA and Wyze Overlay</h2>
          </div>
          <div className="comparison-picker" role="tablist" aria-label="Comparison metric">
            {COMPARISON_METRICS.map((metric) => (
              <button
                key={metric.id}
                className={selectedComparison === metric.id ? 'active' : ''}
                onClick={() => setSelectedComparison(metric.id)}
              >
                {metric.label}
              </button>
            ))}
          </div>
        </div>

        <div className="comparison-layout">
          <div className="comparison-chart">
            <div className="chart-heading compact">
              <div>
                <p className="eyebrow">{comparisonConfig.unit === 'mixed' ? 'Different units' : comparisonConfig.unit}</p>
                <h2>{comparisonConfig.label}</h2>
              </div>
              <div className="method-legend">
                {comparisonSeriesCounts.map((series) => (
                  <span key={series.key}>
                    <i style={{ background: series.color }} />
                    {series.label}
                    <small>{series.count}</small>
                  </span>
                ))}
              </div>
            </div>
            <div className="chart-frame comparison">
              {comparisonData.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={comparisonData} margin={{ top: 18, right: 26, bottom: 8, left: 8 }}>
                    <CartesianGrid stroke="#d9e0e8" strokeDasharray="4 4" />
                    <XAxis dataKey="date" stroke="#5f6f82" tickMargin={10} />
                    <YAxis stroke="#5f6f82" width={54} domain={['auto', 'auto']} />
                    <Tooltip content={<ComparisonTooltip series={comparisonConfig.series} unit={comparisonConfig.unit} />} />
                    {comparisonConfig.series.map((series) => (
                      <Line
                        key={series.key}
                        type="monotone"
                        dataKey={series.key}
                        name={series.label}
                        stroke={series.color}
                        strokeWidth={3}
                        strokeDasharray={series.strokeDasharray}
                        dot={{ r: 3 }}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="chart-empty">
                  <Layers3 size={30} />
                  <p>Import DEXA and Wyze data to compare measurement methods on the same chart.</p>
                </div>
              )}
            </div>
          </div>

          <aside className="comparison-summary">
            <div>
              <Layers3 size={18} />
              <h3>What This Shows</h3>
            </div>
            <p>{comparisonConfig.note}</p>
            {comparisonGap ? (
              <div className="delta-card">
                <span>Nearest DEXA vs Wyze</span>
                <strong>{formatDelta(comparisonGap.delta)} {comparisonConfig.unit}</strong>
                <small>
                  Wyze on {comparisonGap.secondaryPoint.date} vs DEXA on {comparisonGap.primaryPoint.date}
                  {' '}({formatPercent(comparisonGap.pct)})
                </small>
              </div>
            ) : (
              <div className="delta-card muted">
                <span>Nearest DEXA vs Wyze</span>
                <strong>No comparable pair yet</strong>
                <small>Needs both methods within 14 days and matching units.</small>
              </div>
            )}
          </aside>
        </div>
      </section>

      <section className="workspace">
        <aside className="metric-panel">
          <div className="tabs" role="tablist" aria-label="Data source">
            {Object.entries(SOURCE_META).map(([source, meta]) => {
              const Icon = meta.icon;
              return (
                <button
                  key={source}
                  className={activeSource === source ? 'active' : ''}
                  onClick={() => setActiveSource(source)}
                >
                  <Icon size={16} />
                  {meta.label}
                </button>
              );
            })}
          </div>
          <label className="search-box">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find metric"
            />
          </label>
          <div className="metric-list">
            {metricOptions.map((metric) => (
              <button
                key={metric}
                className={selectedMetric === metric ? 'selected' : ''}
                onClick={() => setSelectedMetric(metric)}
              >
                <span>{metric}</span>
                <small>{activeRecords.filter((record) => record.metric === metric).length}</small>
              </button>
            ))}
            {!metricOptions.length && <p className="empty">Import a CSV to begin charting.</p>}
          </div>
        </aside>

        <section className="chart-area">
          <div className="chart-heading">
            <div>
              <p className="eyebrow">{SOURCE_META[activeSource].label}</p>
              <h2>{selectedMetric || 'No metric selected'}</h2>
            </div>
            {trend && (
              <div className={`trend-pill ${trend.direction}`}>
                {trend.direction === 'down' ? <TrendingDown size={16} /> : <TrendingUp size={16} />}
                {formatDelta(trend.delta)} {trend.last.unit}
              </div>
            )}
          </div>

          <div className="chart-frame">
            {selectedRecords.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={selectedRecords} margin={{ top: 18, right: 26, bottom: 8, left: 8 }}>
                  <CartesianGrid stroke="#d9e0e8" strokeDasharray="4 4" />
                  <XAxis dataKey="date" stroke="#5f6f82" tickMargin={10} />
                  <YAxis stroke="#5f6f82" width={48} domain={['auto', 'auto']} />
                  <Tooltip content={<ChartTooltip />} />
                  {selectedRecords[0]?.low !== undefined && (
                    <Line dataKey="low" stroke="#a9b4c1" dot={false} strokeDasharray="5 5" />
                  )}
                  {selectedRecords[0]?.high !== undefined && (
                    <Line dataKey="high" stroke="#a9b4c1" dot={false} strokeDasharray="5 5" />
                  )}
                  <Line type="monotone" dataKey="value" stroke={SOURCE_META[activeSource].color} strokeWidth={3} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="chart-empty">
                <LineChartIcon size={30} />
                <p>Upload CSVs over time to see trajectories, reference bands, and month-adjusted movement.</p>
              </div>
            )}
          </div>

          <div className="insight-row">
            <Insight title="Latest" icon={CalendarDays}>
              {selectedRecords.length ? `${selectedRecords.at(-1).rawValue || selectedRecords.at(-1).value} ${selectedRecords.at(-1).unit} on ${selectedRecords.at(-1).date}` : 'No data yet'}
            </Insight>
            <Insight title="Trend" icon={BarChart3}>
              {trend ? `${formatDelta(trend.monthly)} ${trend.last.unit} per month (${formatPercent(trend.pct)} overall)` : 'Import at least two dates'}
            </Insight>
            <Insight title="Reference" icon={Database}>
              {selectedRecords.at(-1)?.referenceRange || 'No reference range available'}
            </Insight>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Metric</th>
                  <th>Value</th>
                  <th>Unit</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {selectedRecords.map((record) => (
                  <tr key={record.id}>
                    <td>{record.date}</td>
                    <td>{record.metric}</td>
                    <td>{record.rawValue || record.value}</td>
                    <td>{record.unit}</td>
                    <td><span className={`status ${normalizeKey(record.status)}`}>{record.status || 'recorded'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </section>

      <section className="flagged-section">
        <div className="section-heading">
          <h2>Lab Watchlist</h2>
          <p>Out-of-range or nonstandard lab statuses from your imported bloodwork.</p>
        </div>
        <div className="watchlist">
          {flaggedLabs.slice(0, 12).map((record) => (
            <div className="watch-item" key={record.id}>
              <strong>{record.metric}</strong>
              <span>{record.rawValue || record.value} {record.unit}</span>
              <small>{record.status} on {record.date}</small>
            </div>
          ))}
          {!flaggedLabs.length && <p className="empty">No flagged labs imported yet.</p>}
        </div>
      </section>
    </main>
  );
}

function LoginScreen({ loading, error, onLogin }) {
  const [email, setEmail] = useState('skrems@gmail.com');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await onLogin(email, password);
    } catch {
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-panel">
        <p className="eyebrow">Private health dashboard</p>
        <h1>Health Tracker</h1>
        <p>Sign in with your Peptide Power Assistant account to open your health data and matching peptide profile.</p>
        <form onSubmit={submit}>
          <label>
            <span>Email</span>
            <input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} disabled={loading || submitting} required />
          </label>
          <label>
            <span>Password</span>
            <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={loading || submitting} required />
          </label>
          {error && <p className="login-error">{error}</p>}
          <button className="primary-button" type="submit" disabled={loading || submitting}>
            {loading ? 'Checking session' : submitting ? 'Signing in' : 'Sign in'}
          </button>
        </form>
        <small>Health Tracker verifies your credentials against Peptide Power Assistant and does not store your password.</small>
        <span className="version-pill">{APP_VERSION}</span>
      </section>
    </main>
  );
}

function Insight({ title, icon: Icon, children }) {
  return (
    <div className="insight">
      <div><Icon size={16} />{title}</div>
      <strong>{children}</strong>
    </div>
  );
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const value = payload.find((item) => item.dataKey === 'value');
  return (
    <div className="tooltip">
      <strong>{label}</strong>
      <span>{value?.payload.rawValue || value?.value} {value?.payload.unit}</span>
    </div>
  );
}

function ComparisonTooltip({ active, payload, label, series, unit }) {
  if (!active || !payload?.length) return null;
  const seriesByKey = new Map(series.map((item) => [item.key, item]));
  return (
    <div className="tooltip">
      <strong>{label}</strong>
      {payload
        .filter((item) => item.value !== undefined && item.value !== null)
        .map((item) => {
          const config = seriesByKey.get(item.dataKey);
          return (
            <span key={item.dataKey} style={{ color: config?.color || item.color }}>
              {config?.label || item.name}: {formatValue(item.value)} {unit === 'mixed' ? '' : unit}
            </span>
          );
        })}
    </div>
  );
}

function formatDelta(value) {
  if (!Number.isFinite(value)) return '0';
  const formatted = Math.abs(value) >= 10 ? value.toFixed(1) : value.toFixed(2);
  return value > 0 ? `+${formatted}` : formatted;
}

function formatValue(value) {
  if (!Number.isFinite(value)) return '';
  if (Math.abs(value) >= 100) return value.toFixed(1);
  if (Math.abs(value) >= 10) return value.toFixed(2);
  return value.toFixed(3);
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return '0%';
  return `${formatDelta(value)}%`;
}

createRoot(document.getElementById('root')).render(<App />);
