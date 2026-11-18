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

// With multiple outstanding requests, valid replies may arrive in reverse order.
const payload = Uint8Array.from({length: 145}, (_, i) => i);
const meta = new Uint8Array(8);
const fields = new DataView(meta.buffer);
fields.setUint32(0, payload.length, true);
fields.setUint32(4, 0x5813c6f8, true);
const outstanding = [];
const parallel = simulate((x, req) => {
  if (req[3] === 63) {
    assert.equal(req[8], 0);
    return x.receive(station, frame(req, "I", meta));
  }
  assert.equal(req[3], 82);
  outstanding.push(req);
  if (outstanding.length === 3) setImmediate(() => {
    for (const r of outstanding.reverse()) {
      const off = new DataView(r.buffer).getUint32(8, true);
      const reply = frame(r, "D", payload.subarray(off, off + 64));
      x.receive(station, reply);
      x.receive(station, reply);
    }
  });
});
const received = [];
assert.deepEqual(await parallel.download(n => received.push(n)), payload);
assert.deepEqual(received, [0, 17, 81, 145]);

// A slow first block must not prevent the fourth from starting.
const fourBlocks = Uint8Array.from({length: 221}, (_, i) => i);
const fourMeta = new Uint8Array(8);
const fourFields = new DataView(fourMeta.buffer);
fourFields.setUint32(0, fourBlocks.length, true);
fourFields.setUint32(4, 0xbaa05ddf, true);
let first;
const delayed = simulate((x, req) => {
  if (req[3] === 63) return x.receive(station, frame(req, "I", fourMeta));
  const offset = new DataView(req.buffer).getUint32(8, true);
  const reply = frame(req, "D", fourBlocks.subarray(offset, offset + 64));
  if (offset === 0) { first = reply; return; }
  x.receive(station, reply);
  if (offset === 192) x.receive(station, first);
});
assert.deepEqual(await delayed.download(progress), fourBlocks);
assert.equal(delayed.retries, 0);

let started = 0;
const fail = simulate((x, req) => {
  if (req[3] === 63) return x.receive(station, frame(req, "I", meta));
  if (++started === 3) x.receive(station, frame(req, "E", [1]));
});
await assert.rejects(fail.download(progress), /SD card/);
assert.equal(fail.pending.size, 0);
assert.equal(started, 3);
console.log("Picture window, out-of-order blocks, progress and sibling cancellation passed.");
