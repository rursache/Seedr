import { createLogger } from './logger.js';

const logger = createLogger('port-checker');

const CHECK_HOST_API = 'https://check-host.net';
const POLL_DELAY = 3000;
const MAX_POLLS = 4;

export interface PortCheckNode {
  location: string;
  success: boolean;
  time?: number;
  error?: string;
}

export interface PortCheckResult {
  reachable: boolean;
  nodes: PortCheckNode[];
}

/**
 * Check if a port is reachable from outside using check-host.net API.
 * Returns results from multiple global nodes.
 */
export async function checkPortReachable(ip: string, port: number): Promise<PortCheckResult> {
  const host = `${ip}:${port}`;

  // Step 1: Start the TCP check
  const startRes = await fetch(`${CHECK_HOST_API}/check-tcp?host=${encodeURIComponent(host)}&max_nodes=4`, {
    headers: { Accept: 'application/json' },
  });

  if (!startRes.ok) {
    throw new Error(`check-host.net returned ${startRes.status}`);
  }

  const startData = await startRes.json() as {
    ok: number;
    request_id: string;
    nodes: Record<string, [string, string]>;
  };

  if (!startData.ok || !startData.request_id) {
    throw new Error('Failed to start port check');
  }

  const requestId = startData.request_id;
  const nodeLocations = new Map<string, string>();
  for (const [nodeId, info] of Object.entries(startData.nodes)) {
    // info is [countryCode, locationName]
    nodeLocations.set(nodeId, (info as string[])[1] || nodeId);
  }

  // Step 2: Poll for results (nodes need time to complete checks)
  let resultData: Record<string, any> = {};

  for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
    await new Promise((r) => setTimeout(r, POLL_DELAY));

    const resultRes = await fetch(`${CHECK_HOST_API}/check-result/${requestId}`, {
      headers: { Accept: 'application/json' },
    });

    if (!resultRes.ok) {
      throw new Error(`check-host.net result returned ${resultRes.status}`);
    }

    resultData = await resultRes.json() as Record<string, any>;

    // Check if all nodes have reported (no null values left)
    const allDone = Object.values(resultData).every((v) => v !== null);
    if (allDone) break;
  }

  // Step 3: Parse node results
  // Format per node:
  //   Success: [{"time": 0.03, "address": "1.2.3.4"}]
  //   Failure: [{"error": "Connection timed out"}]
  //   Pending: null
  const nodes: PortCheckNode[] = [];
  let anyReachable = false;

  for (const [nodeId, result] of Object.entries(resultData)) {
    const location = nodeLocations.get(nodeId) || nodeId;

    if (result === null) {
      nodes.push({ location, success: false, error: 'Timeout (no response)' });
      continue;
    }

    if (!Array.isArray(result) || result.length === 0) {
      nodes.push({ location, success: false, error: 'No result' });
      continue;
    }

    const entry = result[0];

    if (typeof entry === 'object' && entry !== null) {
      if ('error' in entry) {
        nodes.push({ location, success: false, error: String(entry.error) });
      } else if ('time' in entry) {
        anyReachable = true;
        nodes.push({ location, success: true, time: entry.time });
      } else {
        nodes.push({ location, success: false, error: 'Unexpected response' });
      }
    } else {
      nodes.push({ location, success: false, error: 'Unexpected response' });
    }
  }

  logger.info({ ip, port, reachable: anyReachable, nodeCount: nodes.length }, 'Port check complete');

  return { reachable: anyReachable, nodes };
}
