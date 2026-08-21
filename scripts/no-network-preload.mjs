import { appendFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import https from "node:https";
import http2 from "node:http2";
import dgram from "node:dgram";
import dns from "node:dns";

const marker = process.env.SESTINA_NO_NETWORK_GUARD_MARKER;
if (marker) appendFileSync(marker, `${process.pid}\n`, { encoding: "utf8", flag: "a" });

function blocked(surface) {
  return function sestinaNetworkDenied() {
    const error = new Error(`SESTINA_NETWORK_BLOCKED:${surface}`);
    error.code = "SESTINA_NETWORK_BLOCKED";
    throw error;
  };
}

net.connect = blocked("net.connect");
net.createConnection = blocked("net.createConnection");
net.Socket.prototype.connect = blocked("net.Socket.connect");
tls.connect = blocked("tls.connect");
http.request = blocked("http.request");
http.get = blocked("http.get");
https.request = blocked("https.request");
https.get = blocked("https.get");
http2.connect = blocked("http2.connect");
dgram.createSocket = blocked("dgram.createSocket");
for (const name of ["lookup", "resolve", "resolve4", "resolve6", "resolveAny", "resolveCaa", "resolveCname", "resolveMx", "resolveNaptr", "resolveNs", "resolvePtr", "resolveSoa", "resolveSrv", "resolveTxt", "reverse"]) {
  if (typeof dns[name] === "function") dns[name] = blocked(`dns.${name}`);
  if (dns.promises && typeof dns.promises[name] === "function") dns.promises[name] = blocked(`dns.promises.${name}`);
}
globalThis.fetch = blocked("fetch");
if (typeof globalThis.WebSocket === "function") globalThis.WebSocket = blocked("WebSocket");
syncBuiltinESMExports();
