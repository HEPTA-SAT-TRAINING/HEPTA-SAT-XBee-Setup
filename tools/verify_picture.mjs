import assert from "node:assert/strict";
import {PictureDownload} from "../docs/picture.js";

const station = "0013A20000000001";
const image = new TextEncoder().encode("123456789");
const metadata = Uint8Array.of(9, 0, 0, 0, 0x26, 0x39, 0xf4, 0xcb);

function frame(request, type, body) {
  const bytes = new Uint8Array(request.length + body.length + 2);
  bytes.set(request);
  bytes[3] = type.charCodeAt(0);
  bytes.set(body, request.length);
  let crc = 0xffff;
  for (const b of bytes.subarray(0, -2)) {
    for (let bit = 7; bit >= 0; bit--) {
      const feedback = ((crc >>> 15) ^ (b >>> bit)) & 1;
      crc = ((crc << 1) & 65535) ^ (feedback * 0x1021);
    }
  }
  new DataView(bytes.buffer).setUint16(bytes.length - 2, crc, true);
  return bytes;
}

const simulate = fn => {
  const transfer = new PictureDownload({send: (dest, req) => fn(transfer, req)}, station);
  return transfer;
};
const progress = () => {};
let attempts = 0;
const retry = simulate((x, req) => {
  if (req[3] === 63) return x.receive(station, frame(req, "I", metadata));
  const good = frame(req, "D", image);
  if (++attempts === 1) {
    x.receive("another satellite", good);
    for (const field of [4, 8]) {
      const stale = req.slice();
      stale[field] ^= 1;
      x.receive(station, frame(stale, "D", image));
    }
    good[12] ^= 1;
  }
  x.receive(station, good);
  x.receive(station, good);
});
assert.deepEqual(await retry.download(progress), image);
assert.equal(attempts, 2);
const changed = simulate((x, req) => x.receive(station,
  req[3] === 63 ? frame(req, "I", metadata) : frame(req, "D", image.map(b => b + 1))));
await assert.rejects(changed.download(progress), /checksum mismatch/);
const absent = simulate((x, req) => x.receive(station, frame(req, "E", [1])));
await assert.rejects(absent.download(progress), /SD card/);
const offline = simulate(() => { throw Error("offline"); });
await assert.rejects(offline.download(progress), /No picture reply/);
assert.equal(offline.retries, 3);
const cancelled = simulate(x => x.cancel());
await assert.rejects(cancelled.download(progress), /cancelled/);
console.log("Picture retry, source, session, offset, duplicate, CRC and failure checks passed.");
