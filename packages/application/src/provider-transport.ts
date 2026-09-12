import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
blocked.addSubnet("2001:db8::", 32, "ipv6");
export function providerAddressAllowed(
  address: string,
  locality: "local" | "external",
) {
  const family = isIP(address);
  if (!family) return false;
  if (locality === "local")
    return (
      address === "::1" || (family === 4 && address.split(".")[0] === "127")
    );
  if (family === 4) return !blocked.check(address, "ipv4");
  return globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}
export function assertProviderEndpoint(
  endpoint: string,
  locality: "local" | "external",
) {
  const url = new URL(endpoint),
    host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    (locality === "external"
      ? url.protocol !== "https:"
      : !["http:", "https:"].includes(url.protocol))
  )
    throw new Error("provider_endpoint_rejected");
  if (isIP(host) && !providerAddressAllowed(host, locality))
    throw new Error("provider_endpoint_rejected");
  if (locality === "local" && !isIP(host) && host !== "localhost")
    throw new Error("provider_endpoint_rejected");
  return { url, host };
}
export async function resolveProviderEndpoint(
  endpoint: string,
  locality: "local" | "external",
  resolveDns = lookup,
) {
  const { url, host } = assertProviderEndpoint(endpoint, locality);
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await resolveDns(host, { all: true, verbatim: true });
  if (
    !addresses.length ||
    addresses.length > 32 ||
    addresses.some((item) => !providerAddressAllowed(item.address, locality))
  )
    throw new Error("provider_endpoint_rejected");
  const address = addresses[0];
  if (!address) throw new Error("provider_endpoint_rejected");
  return { url, host, address };
}

/** One validated address, one fresh socket, no proxy environment, redirects or retries. */
export function createPinnedProviderFetch(
  locality: "local" | "external",
  beforeWrite?: () => Promise<void>,
): typeof fetch {
  return async (input: string | URL | Request, init: RequestInit = {}) => {
    if (
      typeof input !== "string" ||
      typeof init.body !== "string" ||
      init.method !== "POST" ||
      init.redirect !== "error" ||
      Buffer.byteLength(init.body) > 1048576
    )
      throw new Error("provider_invalid_request");
    const target = await resolveProviderEndpoint(input, locality);
    init.signal?.throwIfAborted();
    return new Promise<Response>((resolve, reject) => {
      let settled = false,
        bytes = 0;
      const chunks: Buffer[] = [];
      const fail = (code: string) => {
        if (!settled) {
          settled = true;
          reject(Object.assign(new Error(code), { code }));
        }
      };
      const send =
        target.url.protocol === "https:" ? httpsRequest : httpRequest;
      const req = send(
        target.url,
        {
          method: "POST",
          agent: false,
          maxHeaderSize: 16384,
          rejectUnauthorized: true,
          servername: isIP(target.host) ? undefined : target.host,
          headers: {
            ...Object.fromEntries(new Headers(init.headers).entries()),
            "content-length": Buffer.byteLength(init.body as string),
            connection: "close",
          },
          lookup: (_hostname, options, callback) => {
            if (options.all) callback(null, [target.address]);
            else callback(null, target.address.address, target.address.family);
          },
          signal: init.signal ?? undefined,
        },
        (response) => {
          const status = response.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            response.destroy();
            fail("provider_http_error");
            return;
          }
          response.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 524288) {
              response.destroy();
              fail("provider_response_too_large");
            } else chunks.push(chunk);
          });
          response.on("error", () => {
            fail("provider_network_failed");
          });
          response.on("end", () => {
            if (!settled) {
              settled = true;
              resolve(
                new Response(Buffer.concat(chunks), {
                  status,
                  headers: { "content-type": "application/json" },
                }),
              );
            }
          });
        },
      );
      req.setTimeout(120000, () => {
        req.destroy();
        fail("provider_timeout");
      });
      req.on("error", () => {
        fail(
          init.signal?.aborted ? "provider_aborted" : "provider_network_failed",
        );
      });
      req.once("socket", (socket) => {
        socket.once(
          target.url.protocol === "https:" ? "secureConnect" : "connect",
          () => {
            void (async () => {
              // Nothing is queued for the socket before the Kernel rechecks current inputs.
              await beforeWrite?.();
              init.signal?.throwIfAborted();
              req.end(init.body as string);
            })().catch(() => {
              req.destroy();
              fail("provider_configuration_changed");
            });
          },
        );
      });
    });
  };
}
