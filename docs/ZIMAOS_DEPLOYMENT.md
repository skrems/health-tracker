# ZimaOS Deployment

This project is prepared as a ZimaOS/CasaOS Docker app.

## Defaults

- App name: `health-tracker`
- Image: `ghcr.io/skrems/health-tracker:v1.0.2`
- Host port: `8095`
- Container port: `80`
- Persistent data: `/DATA/AppData/health-tracker/data`
- SQLite database: `/DATA/AppData/health-tracker/data/health-tracker.sqlite`
- Compose source path: `/DATA/AppData/health-tracker/source`

The container stores imported measurements in SQLite at `/data/health-tracker.sqlite`, which maps to `/DATA/AppData/health-tracker/data/health-tracker.sqlite` on ZimaOS.

## Local Container Test

```bash
docker compose build
docker compose up -d
docker compose logs --tail 50
docker compose down
```

Open `http://127.0.0.1:8095/`.

## Publish

Push the matching version tag so GitHub Actions publishes the GHCR image:

```bash
git push origin main
git push origin v1.0.2
```

Make the GHCR package public if the ZimaBoard should pull without credentials.

## First-Time ZimaOS Install

```bash
ssh <zimaboard-user>@<zimaboard-host>
mkdir -p /DATA/AppData/health-tracker/source
mkdir -p /DATA/AppData/health-tracker/data
mkdir -p /DATA/AppData/health-tracker/backups
mkdir -p /DATA/AppData/health-tracker/docker-config
```

Copy the compose file:

```bash
rsync -av docker-compose.zima.yml \
  <zimaboard-user>@<zimaboard-host>:/DATA/AppData/health-tracker/source/docker-compose.zima.yml
```

Install from the ZimaOS dashboard:

1. Open App Store.
2. Choose Custom Install.
3. Import Docker Compose.
4. Upload or paste `docker-compose.zima.yml`.
5. Confirm image `ghcr.io/skrems/health-tracker:v1.0.2`, port `8095`, and volume `/DATA/AppData/health-tracker/data:/data`.

## CLI Fallback

```bash
ssh <zimaboard-user>@<zimaboard-host>
cd /DATA/AppData/health-tracker/source

sudo env DOCKER_CONFIG=/DATA/AppData/health-tracker/docker-config \
  docker compose -f docker-compose.zima.yml pull

sudo env DOCKER_CONFIG=/DATA/AppData/health-tracker/docker-config \
  docker compose -f docker-compose.zima.yml up -d
```
