# Health Data Warehouse Integration

The React dashboard can import a normalized warehouse export as JSON or CSV. This lets the Python project own source-specific scraping and cleanup while the web app owns charting.

## Recommended Export Contract

Export either a JSON array:

```json
[
  {
    "source": "bodyspec",
    "date": "2026-07-06",
    "metric": "Body Fat %",
    "value": 18.4,
    "unit": "%",
    "importer": "bodyspec"
  }
]
```

or an object with a `records`, `measurements`, or `data` array:

```json
{
  "records": [
    {
      "source": "wyze",
      "date": "2026-07-06",
      "metric": "Weight",
      "value": 201.1,
      "unit": "lb"
    }
  ]
}
```

CSV exports should use the same field names:

```csv
source,date,metric,value,unit,status,reference_range,importer
bodyspec,2026-07-06,Lean Mass,164.2,lb,,,
wyze,2026-07-06,Weight,201.1,lb,,,
rhythm,2026-07-06,ApoB,71.5,mg/dL,optimal,0 - 90,rhythm
```

## Source Mapping

The dashboard maps these source values:

- `bloodwork`, `blood`, `lab`, `labs`, `rhythm` -> Bloodwork
- `dexa`, `dexascan`, `body_spec`, `bodyspec`, `bodycomposition` -> DEXA
- `scale`, `wyze`, `weight`, `body_scan` -> Scale

Unknown sources are skipped so experimental importers will not break the dashboard.

## Suggested Python Flow

Keep the existing warehouse layout as the ingestion layer:

```text
src/importers/bodyspec.py -> data/processed/bodyspec.json
src/importers/wyze.py     -> data/processed/wyze.json
src/importers/rhythm.py   -> data/processed/rhythm.json
src/exports/dashboard.py  -> data/exports/dashboard-records.json
```

`src/exports/dashboard.py` should combine processed records into the normalized contract above. The dashboard can then import `data/exports/dashboard-records.json`.

## BodySpec Direct Import

The dashboard also directly imports the CSV files emitted by `/Users/skrems/Documents/dexadata/bodyspec_export_v3.py` through the DEXA import button. The most useful file is `bodyspec_dexa_master.csv`, which becomes longitudinal chart series for body fat, lean mass, fat mass, VAT, bone density, RMR, and scan-to-scan change fields.

The companion files add more granular series:

- `bodyspec_dexa_composition_regions.csv`: regional mass and fat percentage series
- `bodyspec_dexa_bone_density.csv`: regional bone density, area, content, and percentile series
- `bodyspec_dexa_percentiles.csv`: BodySpec percentile metrics
- `bodyspec_dexa_rmr.csv`: RMR estimate series by formula
