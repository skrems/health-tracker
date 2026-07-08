import fs from 'node:fs';
import Papa from 'papaparse';

const file = process.argv[2];

if (!file) {
  console.error('Usage: node scripts/validate-dexa.mjs /path/to/bodyspec_dexa_master.csv');
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

const masterMetrics = [
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
];

const csv = fs.readFileSync(file, 'utf8');
const { data, errors } = Papa.parse(csv, { header: true, skipEmptyLines: true });

if (errors.length) {
  console.error(errors);
  process.exit(1);
}

const normalized = data.flatMap((row) => {
  const date = row.scan_date;
  if (!date) return [];
  return masterMetrics.flatMap(([key, metric, unit]) => {
    const parsed = parseNumber(row[key]);
    return parsed ? [{ date, metric, value: parsed.value, rawValue: parsed.raw, unit }] : [];
  });
});

const latestByMetric = new Map();
for (const record of normalized) latestByMetric.set(record.metric, record);

console.log(JSON.stringify({
  rows: data.length,
  normalized: normalized.length,
  scanDates: [...new Set(data.map((row) => row.scan_date).filter(Boolean))],
  metrics: [...new Set(normalized.map((record) => record.metric))],
  latest: Object.fromEntries(
    ['DEXA Weight', 'Body Fat %', 'Fat Mass', 'Lean Mass', 'VAT Mass', 'Bone Mineral Density']
      .map((metric) => {
        const record = latestByMetric.get(metric);
        return [metric, record ? `${record.rawValue} ${record.unit}`.trim() : null];
      })
  ),
}, null, 2));
