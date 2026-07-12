# Health Tracker

Local web app for uploading recurring bloodwork, DEXA, and Wyze scale CSV exports, then charting markers over time.

## Run

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`.

## Import Formats

Bloodwork:

```csv
marker,value,unit,reference_range,status,time
Vitamin B12,311,pg/mL,232 - 1245,average,2026-07-06
```

DEXA accepts BodySpec CSVs from `bodyspec_export_v3.py`, including:

```text
bodyspec_dexa_master.csv
bodyspec_dexa_composition_regions.csv
bodyspec_dexa_bone_density.csv
bodyspec_dexa_percentiles.csv
bodyspec_dexa_rmr.csv
```

DEXA also accepts long format:

```csv
date,metric,value,unit
2026-07-06,Body Fat %,18.4,%
```

or wide format:

```csv
date,body_fat_pct,lean_mass_lbs,fat_mass_lbs,bone_mass_lbs,visceral_fat,android_gynoid_ratio,total_mass_lbs
2026-07-06,18.4,164.2,36.9,7.8,8,0.92,201.1
```

Scale:

```csv
date,weight_lbs,body_fat_pct,muscle_mass_lbs,lean_body_mass_lbs,water_pct,bone_mass_lbs,bmi,visceral_fat
2026-07-06,201.1,19.5,154.3,161.9,57.2,7.8,27.3,8
```

When running through the Node server or Docker container, imported data is stored in SQLite. Local development uses `data/health-tracker.sqlite`; ZimaOS uses `/DATA/AppData/health-tracker/data/health-tracker.sqlite`.

## Health Overview

The Health Overview section provides a single pane across bloodwork, DEXA, and Wyze data. It surfaces the latest values for body composition, cardiometabolic labs, inflammation, nutrients, and hormones, while showing paired DEXA/Wyze values where both methods exist.

## Peptide Connection And Report

When deployed to the ZimaBoard, Health Tracker mounts the Peptide Power Assistant data directory read-only. Select the matching peptide profile in the dashboard to include completed dose logs in the combined Health and Peptide Report.

The report is available on screen and can be printed or saved as a PDF from the browser. It includes health snapshots, body and glucose trends, peptide-use totals, and exploratory correlations between each metric and injection-day frequency over the preceding seven days. These associations do not establish medical causation.

The two apps retain separate SQLite databases. Health Tracker never writes to the peptide database.

## Method Comparison

The dashboard includes a DEXA and Wyze overlay view for measurements that overlap across methods:

- Weight
- Body fat percentage
- Lean mass
- Fat mass
- Bone mass
- RMR/BMR
- Visceral indicators

Scale readings are averaged by date before overlaying, since Wyze can export multiple readings per day. DEXA and Wyze values are shown as separate lines so you can see agreement, drift, or systematic measurement differences.

## Warehouse Export

If you use the separate `health-data-warehouse` Python project for BodySpec, Rhythm, or Wyze ingestion, export normalized records and import that JSON or CSV with the Health Data Warehouse button. See [docs/warehouse-integration.md](docs/warehouse-integration.md).
