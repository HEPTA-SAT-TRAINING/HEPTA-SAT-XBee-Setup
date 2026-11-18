import assert from "node:assert/strict";
import {BROADCAST, encodeFrame, FrameReader, GroundRadio} from "../docs/ground-radio.js";

const frames = [];
const reader = new FrameReader(data => frames.push([...data]));
const first = [0x90, 0x7e, 0xff];
const broken = encodeFrame([0x90, 1]);
broken[broken.length - 1] ^= 1;
for (const byte of [0x20, 0x7e, 0xff, 0xff, ...broken, ...encodeFrame(first), ...encodeFrame([0x8a, 2])]) {
  reader.push([byte]);
}
assert.deepEqual(frames, [first, [0x8a, 2]]);

const writes = [], rx = [], found = [];
const link = {write: async bytes => writes.push([...bytes])};
const radio = new GroundRadio(link, (...args) => rx.push(args), address => found.push(address));
radio.info = {NP:"54", NT:"3C"};
const addresses = [0,0x13,0xa2,0,0x42,0x3f,0x15,0xcc];
const id = "0013A200423F15CC";
const payload = Uint8Array.of(0x7e, 0, 0xff);

const scan = radio.discover();
const scanId = writes.at(-1)[4];
const sending = radio.send(id, payload);
const request = writes.at(-1);
const txId = request[4];
assert.deepEqual(request.slice(3,-1), [0x10,txId,...addresses,0xff,0xfe,0,0,...payload]);
radio.receive(Uint8Array.of(0x88,scanId,78,68,0,0xff,0xfe,...addresses));
radio.receive(Uint8Array.of(0x90,...addresses,0x12,0x34,2,...payload));
assert.deepEqual(rx, [[id, payload, true]]);
assert.deepEqual(found, [id, id]);
radio.receive(Uint8Array.of(0x8b,scanId,0,0,0,0,0)); // Wrong type for the discovery frame ID.
radio.receive(Uint8Array.of(0x8b,txId,0,0,0,0,0));
radio.receive(Uint8Array.of(0x88,scanId,78,68,0));
await Promise.all([scan,sending]);

const broadcast = radio.send(BROADCAST,payload);
assert.deepEqual(writes.at(-1).slice(5,13), [0,0,0,0,0,0,255,255]);
radio.receive(Uint8Array.of(0x8b,writes.at(-1)[4],0,0,0,0x25,0));
await assert.rejects(broadcast,/0x25/);
await assert.rejects(radio.send(id,new Uint8Array(85)),/84 bytes/);
radio.info.NP = "FF";
await assert.rejects(radio.send(BROADCAST,new Uint8Array(85)),/84 bytes/);
const pending = radio.send(id,payload);
radio.cancelPending();
await assert.rejects(pending,/session ended/);
console.log("PASS API framing, discovery, RX addresses, direct/broadcast TX and status correlation");
