# Seedr

BitTorrent ratio master — emulates BT clients and reports simulated upload to private trackers.

Inspired by [JOAL](https://github.com/anthonyraymond/joal), built from scratch with TypeScript and Vue.js.

## How It Works

Seedr loads `.torrent` files, connects to their trackers, and announces simulated upload data — without actually downloading or uploading any content. It emulates real BitTorrent clients (qBittorrent, Deluge, Transmission, uTorrent, BitTorrent) by replicating their exact announce behavior: peer IDs, key generation, URL encoding, headers, and query parameter ordering.

**Key features:**
- 5 built-in client profiles with accurate protocol emulation
- HTTP and UDP (BEP-15) tracker support with automatic failover
- Bandwidth simulation with weighted distribution and jitter
- Real-time web dashboard with drag-and-drop torrent upload
- Port reachability checker via [check-host.net](https://check-host.net)
- Docker support with persistent data volume
- Configurable upload ratio targets, simultaneous seed limits, and more

## Quick Start

### Docker (recommended)

```bash
docker compose up -d
```

The web UI is available at `http://localhost:8080`. Drop `.torrent` files into the `data/torrents/` directory or upload via the dashboard.

### Docker manual

```bash
docker build -t seedr .
docker run -d \
  --name seedr \
  -p 8080:8080 \
  -v ./data:/data \
  -e NODE_ENV=production \
  -e SEEDR_DATA_DIR=/data \
  -e WEB_PORT=8080 \
  seedr
```

### Local development

Requires Node.js 22+.

```bash
# Install dependencies
npm install
cd ui && npm install && cd ..

# Start in development mode (hot reload)
npm run dev
```

The dev server starts the backend on port 8080 with hot reload. The frontend dev server proxies API requests to the backend.

### Production build

```bash
npm run build
npm start
```

## Configuration

All configuration is managed through the web UI Settings panel. Settings are persisted to `data/config.json`.

| Setting | Default | Description |
|---------|---------|-------------|
| Client Profile | qbittorrent-5.1.4 | Which BT client to emulate |
| Port | 0 (random) | Listening port announced to trackers (0 = random 49152-65534) |
| Min Upload Rate | 100 KB/s | Minimum simulated upload speed |
| Max Upload Rate | 500 KB/s | Maximum simulated upload speed |
| Simultaneous Seeds | -1 (all) | How many torrents to seed at once (-1 = unlimited) |
| Upload Ratio Target | -1 (unlimited) | Stop seeding after reaching this ratio (-1 = never stop) |
| Min Leechers | 0 | Only report upload when this many leechers are present |
| Keep With Zero Leechers | true | Keep seeding torrents that have no leechers |
| Skip If No Peers | true | Don't report upload if no peers are connected |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SEEDR_DATA_DIR` | `data` | Root directory for config, state, torrents, and client profiles |
| `SEEDR_CLIENTS_DIR` | `$SEEDR_DATA_DIR/clients` | Directory containing `.client` profile files |
| `SEEDR_TORRENTS_DIR` | `$SEEDR_DATA_DIR/torrents` | Directory for `.torrent` files (watched for changes) |
| `WEB_PORT` | `8080` | Web UI and API port |
| `LOG_LEVEL` | `info` | Log level (debug, info, warn, error) |

## Data Directory Structure

```
data/
  config.json          # Application settings
  state.json           # Persisted upload state (survives restarts)
  clients/             # BT client profile files (.client)
    qbittorrent-5.1.4.client
    deluge-2.1.1.client
    transmission-3.00.client
    bittorrent-7.10.3_44429.client
    utorrent-3.5.4_44498.client
  torrents/            # Drop .torrent files here
```

Client profiles are automatically seeded on first run. The torrents directory is watched for file changes — adding or removing `.torrent` files is reflected in the UI immediately.

## Client Profiles

Each `.client` file defines how Seedr emulates a specific BitTorrent client:

- **qBittorrent 5.1.4** — HASH_NO_LEADING_ZERO key, REGEX peer ID
- **Deluge 2.1.1** — HASH_NO_LEADING_ZERO key, REGEX peer ID
- **Transmission 3.00** — DIGIT_RANGE_HEX key, RANDOM_POOL_WITH_CHECKSUM peer ID
- **BitTorrent 7.10.3** — HASH key, REGEX peer ID with URL encoding
- **uTorrent 3.5.4** — HASH key, REGEX peer ID with URL encoding

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/config` | Get current configuration |
| `PUT` | `/api/config` | Update configuration |
| `GET` | `/api/config/clients` | List available client profiles |
| `GET` | `/api/torrents` | List loaded torrents |
| `POST` | `/api/torrents` | Upload a .torrent file (multipart) |
| `DELETE` | `/api/torrents/:hash` | Remove a torrent |
| `POST` | `/api/torrents/:hash/announce` | Force an immediate announce |
| `POST` | `/api/control/start` | Start seeding |
| `POST` | `/api/control/stop` | Stop seeding |
| `GET` | `/api/control/status` | Get engine status |
| `GET` | `/api/control/port-check` | Check port reachability |

Real-time updates are available via Socket.IO on the same port.

## Tests

```bash
npm test              # Run once
npm run test:watch    # Watch mode
```

## License

MIT
