# Client Profile Guide

This directory contains `.client` profile files that define how Seedr emulates specific BitTorrent clients. Each profile controls every aspect of how the app identifies itself to trackers: peer ID, key generation, HTTP headers, query parameter ordering, and URL encoding.

Trackers (especially private ones running UNIT3D, Gazelle, etc.) fingerprint clients based on all of these fields. Getting any one of them wrong can trigger "Abnormal access blocked" or similar errors. The parameter order, header order, and encoding rules must exactly match the real client.

## File Format

Each `.client` file is a JSON document with this structure:

```json
{
  "keyGenerator": { ... },
  "peerIdGenerator": { ... },
  "urlEncoder": { ... },
  "query": "...",
  "numwant": 200,
  "numwantOnStop": 0,
  "requestHeaders": [ ... ]
}
```

Seedr picks up any `.client` file placed in this directory automatically. The filename becomes the profile name shown in the Settings UI (e.g. `qbittorrent-5.1.4.client` appears as "qbittorrent-5.1.4").

---

## Field Reference

### `peerIdGenerator`

The peer ID is a 20-byte value that uniquely identifies a client instance to the swarm. Every BitTorrent client follows [BEP-20](https://www.bittorrent.org/beps/bep_0020.html) (Azureus-style), which uses an 8-byte ASCII prefix followed by 12 bytes of random data.

The prefix format is `-XXYYYY-` where `XX` is the client code and `YYYY` encodes the version:

| Client | Code | Prefix Example | Version Encoding |
|--------|------|----------------|------------------|
| qBittorrent | `qB` | `-qB5140-` | `{major}{minor}{patch}0` |
| Deluge | `DE` | `-DE211s-` | `{major}{minor}{patch}s` |
| Transmission | `TR` | `-TR3000-` | `{major}{minor}{patch}0` |
| uTorrent | `UT` | `-UT354S-` | `{major}{minor}{patch}S` |
| BitTorrent | `BT` | `-BT7a3S-` | `{major_hex}{minor_hex}{patch}S` |

```json
"peerIdGenerator": {
  "algorithm": { ... },
  "refreshOn": "NEVER",
  "shouldUrlEncode": false
}
```

**`algorithm`** controls how the 20-byte peer ID is generated. Two types are supported:

#### `REGEX` (most clients)

Generates a peer ID by evaluating a regex pattern. The pattern must produce exactly 20 characters.

```json
{
  "type": "REGEX",
  "pattern": "-qB5140-[A-Za-z0-9_~\\(\\)\\!\\.\\*-]{12}"
}
```

The suffix character set depends on the client family:

- **libtorrent-based** (qBittorrent, Deluge): `[A-Za-z0-9_~\()\!\.\*-]` - printable ASCII subset
- **uTorrent/BitTorrent**: `[\x01-\xFF]` - raw bytes (with some fixed prefix bytes like `\xD2\xAD`)

For clients with raw binary peer IDs (uTorrent, BitTorrent), the regex uses unicode escape sequences that map to byte values:

```json
{
  "type": "REGEX",
  "pattern": "-UT354S-(\\u00d2)(\\u00ad)[\\u0001-\\u00ff]{10}"
}
```

This means: the prefix `-UT354S-`, then byte `0xD2`, byte `0xAD`, then 10 random bytes in range `0x01-0xFF`.

#### `RANDOM_POOL_WITH_CHECKSUM` (Transmission)

Transmission uses a unique scheme: prefix + random characters from a pool + a checksum character.

```json
{
  "type": "RANDOM_POOL_WITH_CHECKSUM",
  "prefix": "-TR3000-",
  "charactersPool": "0123456789abcdefghijklmnopqrstuvwxyz",
  "base": 36
}
```

The checksum is calculated as: `pool[sum_of_random_character_indices % base]`. This produces a 20-byte peer ID: 8-byte prefix + 11 random chars + 1 checksum char.

**`refreshOn`** controls when the peer ID is regenerated:

| Value | Behavior |
|-------|----------|
| `NEVER` | Generated once at startup, never changes. Used by qBittorrent, Deluge, uTorrent, BitTorrent. |
| `TORRENT_VOLATILE` | Regenerated each time a torrent sends a `started` event. Used by Transmission. |

**`shouldUrlEncode`** controls whether the peer ID gets URL-encoded when building the announce query:
- `false` for clients whose peer IDs are ASCII-safe (qBittorrent, Deluge, Transmission)
- `true` for clients with raw binary peer IDs (uTorrent, BitTorrent)

---

### `keyGenerator`

The `key` is a token sent to the tracker that helps identify the client across announces. Its format and refresh behavior vary significantly between clients.

```json
"keyGenerator": {
  "algorithm": { ... },
  "refreshOn": "TORRENT_PERSISTENT",
  "keyCase": "upper"
}
```

**`algorithm`** types:

#### `HASH` / `HASH_NO_LEADING_ZERO`

Generates a random hexadecimal string of the specified length.

```json
{ "type": "HASH", "length": 8 }
{ "type": "HASH_NO_LEADING_ZERO", "length": 8 }
```

`HASH_NO_LEADING_ZERO` rejects values starting with `0` and regenerates until it gets one that doesn't. This is used by libtorrent-based clients (qBittorrent, Deluge).

`HASH` (without the leading-zero restriction) is used by uTorrent and BitTorrent.

#### `DIGIT_RANGE_TRANSFORMED_TO_HEX_WITHOUT_LEADING_ZEROES`

Generates a random integer in a range, then converts it to hexadecimal (no zero-padding).

```json
{
  "type": "DIGIT_RANGE_TRANSFORMED_TO_HEX_WITHOUT_LEADING_ZEROES",
  "inclusiveLowerBound": 1,
  "inclusiveUpperBound": 2147483647
}
```

This is used by Transmission. The range `1` to `2147483647` (0x7FFFFFFF) produces keys like `3a2b1c`, `7fff`, etc.

**`keyCase`** applies case transformation to the generated key:
- `"upper"` - uppercase hex (e.g. `A3F2B1C0`) - used by qBittorrent, Deluge, uTorrent, BitTorrent
- `"lower"` - lowercase hex (e.g. `a3f2b1c0`) - used by Transmission

**`refreshOn`** controls when the key is regenerated:

| Value | Behavior |
|-------|----------|
| `NEVER` | Generated once, never changes. Used by Transmission. |
| `TORRENT_PERSISTENT` | One key per torrent, persists across sessions. Used by qBittorrent, Deluge. |
| `TIMED_OR_AFTER_STARTED_ANNOUNCE` | Regenerated after every N announces AND after every `started` event. Used by uTorrent, BitTorrent. Requires `refreshEvery` field. |

**`refreshEvery`** (only for `TIMED` / `TIMED_OR_AFTER_STARTED_ANNOUNCE`): the number of announces between key refreshes. uTorrent and BitTorrent use `10`.

---

### `urlEncoder`

Controls how binary data (info_hash, peer_id) is percent-encoded in the announce URL.

```json
"urlEncoder": {
  "encodingExclusionPattern": "[A-Za-z0-9_~\\(\\)\\!\\.\\*-]",
  "encodedHexCase": "lower"
}
```

**`encodingExclusionPattern`** is a regex defining which characters are NOT percent-encoded:
- libtorrent-based (qBittorrent, Deluge): `[A-Za-z0-9_~\()\!\.\*-]` - broader set
- Transmission, uTorrent, BitTorrent: `[A-Za-z0-9-]` - narrower set

This matters because trackers can detect mismatches. For example, byte `0x7E` (`~`) is left unencoded by qBittorrent but would be encoded as `%7e` by Transmission.

**`encodedHexCase`** controls the case of hex digits in percent-encoded output:
- `"lower"` produces `%2f` - used by all current profiles
- `"upper"` produces `%2F`

---

### `query`

The URL query string template with placeholder tokens. This defines the exact parameter names and their order in every announce request.

```
info_hash={infohash}&peer_id={peerid}&port={port}&uploaded={uploaded}&downloaded={downloaded}&left={left}&corrupt=0&key={key}&event={event}&numwant={numwant}&compact=1&no_peer_id=1&supportcrypto=1&redundant=0
```

**The order of parameters matters.** Trackers fingerprint clients by checking which parameters are present and in what sequence.

Available placeholders:

| Placeholder | Description |
|-------------|-------------|
| `{infohash}` | URL-encoded 20-byte info hash |
| `{peerid}` | Peer ID (encoding depends on `shouldUrlEncode`) |
| `{port}` | Listening port |
| `{uploaded}` | Total bytes uploaded |
| `{downloaded}` | Total bytes downloaded |
| `{left}` | Bytes remaining (always `0` since we're seeding) |
| `{event}` | Announce event: `started`, `stopped`, or empty (removed from URL when empty) |
| `{numwant}` | Number of peers requested |
| `{key}` | Tracker key |
| `{ip}` | IPv4 address (removed if unavailable) |
| `{ipv6}` | IPv6 address (removed if unavailable) |

Extra static parameters vary by client family:

| Client Family | Extra Parameters |
|---------------|-----------------|
| qBittorrent, Deluge | `corrupt=0`, `compact=1`, `no_peer_id=1`, `supportcrypto=1`, `redundant=0` |
| Transmission | `compact=1`, `supportcrypto=1`, includes `{ipv6}` |
| uTorrent, BitTorrent | `corrupt=0`, `compact=1`, `no_peer_id=1` |

---

### `numwant` / `numwantOnStop`

How many peers to request from the tracker.

- **`numwant`**: used for normal announces. qBittorrent/Deluge/uTorrent/BitTorrent use `200`, Transmission uses `80`.
- **`numwantOnStop`**: used when sending a `stopped` event. Always `0` for all known clients.

---

### `requestHeaders`

HTTP headers sent with every tracker announce, in exact order. The header names, values, and ordering are all fingerprinting vectors.

```json
"requestHeaders": [
  { "name": "User-Agent", "value": "qBittorrent/5.1.4" },
  { "name": "Accept-Encoding", "value": "gzip" },
  { "name": "Connection", "value": "close" }
]
```

Only the headers listed here are sent. Seedr uses raw `node:http`/`node:https` requests (not `fetch()`) specifically to avoid leaking extra default headers.

Header patterns by client family:

| Client | User-Agent | Other Headers |
|--------|-----------|---------------|
| qBittorrent 5.1.4 | `qBittorrent/5.1.4` | `Accept-Encoding: gzip`, `Connection: close` |
| Deluge 2.1.1 | `Deluge/2.1.1 libtorrent/1.2.15.0` | `Accept-Encoding: gzip`, `Connection: close` |
| Transmission 3.00 | `Transmission/3.00` | `Accept: */*`, `Accept-Encoding: deflate, gzip` |
| uTorrent 3.5.4 | `uTorrent/354(111783378)(44498)` | `Accept-Encoding: gzip`, `Connection: Close` |
| BitTorrent 7.10.3 | `BitTorrent/7103(256355725)(44429)` | `Accept-Encoding: gzip`, `Connection: Close` |

Note the differences: Transmission sends `Accept: */*` while others don't. uTorrent/BitTorrent capitalize `Close`. The `Accept-Encoding` value order differs (`gzip` vs `deflate, gzip`).

---

## Creating a New Profile

### Method 1: From Source Code (open-source clients)

This is the most reliable method. Works for qBittorrent, Transmission, Deluge, rTorrent, and any other open-source client.

**Step 1: Find the peer ID prefix**

Look for `PEER_ID_PREFIX`, `peerid_prefix`, or the peer ID construction in the source code.

For qBittorrent, check `src/base/bittorrent/sessionimpl.cpp`:
```cpp
const QString peerId = QString("-qB%1%2%3%4-")
    .arg(major).arg(minor).arg(patch).arg("0");
```

For Transmission, check `libtransmission/session.h` and `CMakeLists.txt`:
```
TR_NAME "Transmission"
prefix: -TR{major}{minor}{patch}0-
```

For Deluge, check `deluge/core/core.py`:
```python
peer_id = '-DE%s%s%s%s-' % (major, minor, micro, tag)
```

**Step 2: Find the peer ID suffix character set**

The suffix generation is usually in the same area as the prefix. libtorrent-based clients use the unreserved URL character set. Transmission uses its base-36 pool with checksum.

**Step 3: Find the key generation**

Search for `key` in the tracker announce code:

- qBittorrent/Deluge (libtorrent): random hex, no leading zero, 8 chars, generated once per torrent
- Transmission: random integer 1-2147483647 converted to hex, generated once per session
- uTorrent/BitTorrent: random hex, 8 chars, refreshed every 10 announces

**Step 4: Capture the query string**

Find the HTTP tracker announce function and note the exact parameter names and order. In libtorrent-based clients, look for `tracker_request::url` construction. In Transmission, look for `announce_url_new`.

**Step 5: Find the HTTP headers**

Look for `User-Agent` and any other headers set on tracker HTTP requests. Check for `Accept-Encoding`, `Connection`, `Accept` headers specifically.

**Step 6: Find the URL encoding rules**

Look for how `info_hash` and `peer_id` are percent-encoded. The key difference is which characters are excluded from encoding.

**Step 7: Find numwant**

Search for `numwant` or the number of peers requested in announce calls.

### Method 2: From Traffic Capture (closed-source clients)

Required for uTorrent, BitTorrent, and any client where source code isn't available.

**Step 1: Set up Wireshark**

Install [Wireshark](https://www.wireshark.org/) and start capturing on your network interface. Use the display filter:

```
http.request.uri contains "announce"
```

For HTTPS trackers, you'll need [mitmproxy](https://mitmproxy.org/) instead:

```bash
mitmproxy --mode regular --listen-port 8888
```

Then configure the client to use `127.0.0.1:8888` as its HTTP proxy.

**Step 2: Add a torrent and capture the first announce**

Add any torrent to the client. The first announce will be a `started` event. Capture the full HTTP request.

**Step 3: Extract the data**

From the captured request, note:

1. **Full URL** - gives you the query string template with parameter order
2. **All HTTP headers** in exact order - gives you `requestHeaders`
3. **`User-Agent` value** - exact version string
4. **`peer_id` value** - URL-decode it to get the raw bytes, identify the prefix and suffix pattern
5. **`key` value** - note the format (hex length, case)
6. **URL encoding** - check how `info_hash` bytes are encoded (which chars are excluded, hex case)

**Step 4: Determine refresh behavior**

Run multiple announces and compare:

- Does `peer_id` change between announces? Between restarts? Between torrents?
- Does `key` change between announces? After how many?
- Restart the client and check if `peer_id` and `key` are regenerated

**Step 5: Write the profile**

Use an existing `.client` file as a template and fill in all the fields.

---

## Worked Example: qBittorrent 5.2.0

Let's walk through creating a profile for a hypothetical new qBittorrent version.

**1. Peer ID prefix**: qBittorrent uses `-qB{major}{minor}{patch}0-`, so version 5.2.0 would be `-qB5200-`.

**2. Peer ID suffix**: qBittorrent uses libtorrent, which generates 12 random chars from `[A-Za-z0-9_~()\!\.\*-]`.

**3. Key**: libtorrent generates an 8-char hex string with no leading zero, persisted per torrent. Uppercase.

**4. Query**: Same as other libtorrent-based clients (this rarely changes between versions).

**5. Headers**: `User-Agent: qBittorrent/5.2.0`, then `Accept-Encoding: gzip`, then `Connection: close`.

**6. URL encoding**: libtorrent excludes `[A-Za-z0-9_~()\!\.\*-]` from encoding, uses lowercase hex.

The resulting file `qbittorrent-5.2.0.client`:

```json
{
  "keyGenerator": {
    "algorithm": {
      "type": "HASH_NO_LEADING_ZERO",
      "length": 8
    },
    "refreshOn": "TORRENT_PERSISTENT",
    "keyCase": "upper"
  },
  "peerIdGenerator": {
    "algorithm": {
      "type": "REGEX",
      "pattern": "-qB5200-[A-Za-z0-9_~\\(\\)\\!\\.\\*-]{12}"
    },
    "refreshOn": "NEVER",
    "shouldUrlEncode": false
  },
  "urlEncoder": {
    "encodingExclusionPattern": "[A-Za-z0-9_~\\(\\)\\!\\.\\*-]",
    "encodedHexCase": "lower"
  },
  "query": "info_hash={infohash}&peer_id={peerid}&port={port}&uploaded={uploaded}&downloaded={downloaded}&left={left}&corrupt=0&key={key}&event={event}&numwant={numwant}&compact=1&no_peer_id=1&supportcrypto=1&redundant=0",
  "numwant": 200,
  "numwantOnStop": 0,
  "requestHeaders": [
    { "name": "User-Agent", "value": "qBittorrent/5.2.0" },
    { "name": "Accept-Encoding", "value": "gzip" },
    { "name": "Connection", "value": "close" }
  ]
}
```

For a new version of the same client family, only the peer ID prefix and User-Agent typically change. The rest stays identical.

---

## Quick Reference: Client Families

Clients that share the same library have nearly identical profiles. Only the peer ID prefix and User-Agent string differ.

| Family | Clients | Library |
|--------|---------|---------|
| libtorrent-rasterbar | qBittorrent, Deluge | [libtorrent](https://github.com/arvidn/libtorrent) |
| Mainline | uTorrent, BitTorrent | Same closed-source codebase |
| Transmission | Transmission | [Transmission](https://github.com/transmission/transmission) |

When creating a profile for a new version of qBittorrent, you can copy the existing qBittorrent profile and change just the peer ID prefix and User-Agent. Same for Deluge, uTorrent/BitTorrent pairs, etc.

---

## Validation

After creating a profile, verify it works:

1. Select the new profile in Settings
2. Add a torrent and start seeding
3. Check the event log for `announce:success` events
4. If you see `announce:failure` with tracker errors, compare your profile against a known-working one for the same client family

Common issues:
- **"Abnormal access blocked"** - usually wrong headers, extra headers, or wrong parameter order
- **"Invalid peer_id"** - wrong prefix format or length (must be exactly 20 bytes)
- **"Client not allowed"** - the User-Agent or peer ID prefix doesn't match the tracker's whitelist

---

## Credits

The profile format and bundled profiles originate from the [JOAL](https://github.com/anthonyraymond/joal) project by Anthony Raymond. JOAL's repository contains ~90 profiles and automated scripts for generating new ones from client source code.
