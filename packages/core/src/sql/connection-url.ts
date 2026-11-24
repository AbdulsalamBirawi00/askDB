import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

export type ConnectionUrlErrorCode = "invalid_url" | "blocked_host";

/** Safe to show to the user: never contains the URL or any part of it. */
export class ConnectionUrlError extends Error {
  constructor(public readonly code: ConnectionUrlErrorCode) {
    super(
      code === "blocked_host"
        ? "This host is not allowed"
        : "Enter a valid postgres:// connection URL",
    );
    this.name = "ConnectionUrlError";
  }
}

/** Query parameters that cannot redirect the connection elsewhere or read local files. */
const ALLOWED_PARAMS = new Set(["sslmode", "channel_binding", "connect_timeout"]);

/**
 * Checks the shape of a connection URL: postgres scheme, a single TCP host, a user,
 * a database, and only harmless query parameters (no `host=`, `hostaddr=`, `sslcert=`...).
 */
export function parseConnectionUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ConnectionUrlError("invalid_url");
  }
  const valid =
    (url.protocol === "postgres:" || url.protocol === "postgresql:") &&
    url.hostname !== "" &&
    !url.hostname.includes(",") &&
    !url.hostname.startsWith("%2f") &&
    url.username !== "" &&
    url.pathname.length > 1 &&
    [...url.searchParams.keys()].every((key) => ALLOWED_PARAMS.has(key));
  if (!valid) throw new ConnectionUrlError("invalid_url");
  return url;
}

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96], // NAT64 can reach IPv4 private ranges
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

/** True for loopback, private, link-local, metadata, and other non-public addresses. */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return blocked.check(address, "ipv4");
  if (version === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return blocked.check(mapped[1]!, "ipv4");
    return blocked.check(address, "ipv6");
  }
  return true; // Not an IP at all: refuse rather than guess.
}

const BLOCKED_NAMES = /(^|\.)(localhost|internal|local)$|^metadata\.google\.internal$/i;

export type LookupFn = (hostname: string) => Promise<{ address: string }[]>;

const defaultLookup: LookupFn = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

/**
 * SSRF protection: refuses hosts that are, or resolve to, internal addresses.
 * Every resolved address must be public. (The driver resolves the name again when it
 * connects; Neon and most hosted Postgres need the hostname for TLS/SNI routing.)
 */
export async function assertPublicHost(
  hostname: string,
  lookup: LookupFn = defaultLookup,
): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (BLOCKED_NAMES.test(host)) throw new ConnectionUrlError("blocked_host");
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new ConnectionUrlError("blocked_host");
    return;
  }
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host);
  } catch {
    // Unresolvable: the connection attempt would fail anyway; report it as a failed connection.
    return;
  }
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new ConnectionUrlError("blocked_host");
  }
}

/** Parses the URL and, unless private hosts are allowed (local dev, CI), checks the host. */
export async function validateConnectionUrl(
  raw: string,
  options: { allowPrivateHosts: boolean; lookup?: LookupFn },
): Promise<URL> {
  const url = parseConnectionUrl(raw);
  if (!options.allowPrivateHosts) await assertPublicHost(url.hostname, options.lookup);
  return url;
}
