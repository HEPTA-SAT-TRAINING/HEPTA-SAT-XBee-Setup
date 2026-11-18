import {LabRadio} from "./lab-radio.js";

export const BROADCAST = "000000000000FFFF";
export const addressHex = bytes => Array.from(bytes, n => n.toString(16).padStart(2, "0")).join("").toUpperCase();

export function encodeFrame(data) {
  const checksum = 255 - (data.reduce((sum, byte) => sum + byte, 0) & 255);
  return Uint8Array.of(0x7e, data.length >> 8, data.length & 255, ...data, checksum);
}

export class FrameReader {
  constructor(receive) {
    this.receive = receive;
    this.buffer = [];
  }

  push(chunk) {
    for (const byte of chunk) {
      if (this.buffer.length || byte === 0x7e) this.buffer.push(byte);
      while (this.buffer.length >= 3) {
        const size = this.buffer[1] * 256 + this.buffer[2];
        if (size && size <= 512) {
          if (this.buffer.length < size + 4) break;
          const frame = this.buffer.slice(3, size + 4);
          if ((frame.reduce((sum, n) => sum + n, 0) & 255) === 255) {
            this.buffer.splice(0, size + 4);
            this.receive(Uint8Array.from(frame.slice(0, -1)));
            continue;
          }
        }
        const next = this.buffer.indexOf(0x7e, 1);
        this.buffer = next < 0 ? [] : this.buffer.slice(next);
      }
    }
  }
}

export class GroundRadio {
  constructor(link, onPacket, onRadio) {
    this.link = link;
    this.onPacket = onPacket;
    this.onRadio = onRadio;
    this.reader = new FrameReader(frame => this.receive(frame));
    this.nextId = 1;
    this.pending = new Map();
    this.restoreNeeded = false;
  }

  async start() {
    const at = new LabRadio(this.link, false);
    // An interrupted API session can still be returning ND records. Leave
    // binary mode first, then enter it through the same path as a fresh kit.
    let discoveryDrainMs = 0;
    await at.session(async () => {
      const info = await at.readRegisters(["HV","VR","AP"]);
      if (!info.HV.startsWith("2E") || !info.VR.startsWith("4") || !["0","1"].includes(info.AP))
        throw Error("Select an S2C Zigbee USB ground station with standard receive frames.");
      this.restoreNeeded = true;
      if (info.AP === "1") {
        const {NT} = await at.readRegisters(["NT"]);
        discoveryDrainMs = parseInt(NT, 16) * 100 + 1200;
      }
      await at.request(discoveryDrainMs ? "ATAP0\r" : "ATAP1\r", /OK\r/);
    }, /OK\r/); // A binary frame checksum may immediately precede the entry reply.
    if (discoveryDrainMs) {
      await new Promise(resolve => setTimeout(resolve, discoveryDrainMs));
      await at.session(() => at.request("ATAP1\r", /OK\r/));
    }
    this.link.onData = bytes => this.reader.push(bytes);
    this.info = {};
    for (const key of ["AP","AO","AI","OP","CH","SH","SL","DH","DL","NP","NT"]) {
      const frame = await this.exchange([0x08, 0, key.charCodeAt(0), key.charCodeAt(1)], 0x88, 3000);
      if (frame.length <= 5) throw Error("Missing XBee setting: " + key);
      this.info[key] = addressHex(frame.subarray(5));
    }
    if (this.info.AP !== "01" || this.info.AO !== "00") throw Error("Use API mode 1 with standard receive frames.");
    if (this.info.AI !== "00") throw Error("Ground station is offline. Join a network in Network setup.");
    return this.info;
  }

  async restore() {
    if (this.scan) await this.scan.catch(() => {});
    this.cancelPending();
    if (!this.restoreNeeded) return;
    const at = new LabRadio(this.link, false);
    await at.session(async () => {
      await at.request("ATAP0\r", /OK\r/);
      const {AP} = await at.readRegisters(["AP"]);
      if (AP !== "0") throw Error("Could not restore Transparent mode.");
    }, /OK\r/);
    this.restoreNeeded = false;
  }

  cancelPending() {
    for (const request of this.pending.values()) request.finish(Error("USB session ended."));
  }

  exchange(data, type, timeout, onPart) {
    const id = this.nextId;
    do { this.nextId = this.nextId % 255 + 1; } while (this.pending.has(this.nextId));
    data[1] = id;
    return new Promise((resolve, reject) => {
      const finish = (error, frame) => {
        if (!this.pending.delete(id)) return;
        clearTimeout(timer);
        if (error) reject(error); else resolve(frame);
      };
      // Some S2C firmware ends discovery silently when NT expires.
      const timer = setTimeout(() => finish(onPart ? null : new DOMException("No radio status received.", "TimeoutError")), timeout);
      this.pending.set(id, {type, data, finish, onPart});
      this.link.write(encodeFrame(data)).catch(error => finish(error));
    });
  }

  receive(frame) {
    if (frame[0] === 0x90 && frame.length >= 12) {
      const source = addressHex(frame.subarray(1, 9));
      this.onRadio(source);
      this.onPacket(source, frame.subarray(12), Boolean(frame[11] & 2));
      return;
    }
    const request = this.pending.get(frame[1]);
    if (!request || request.type !== frame[0]) return;
    if (frame[0] === 0x88) {
      if (frame.length < 5 || frame[2] !== request.data[2] || frame[3] !== request.data[3]) return;
      if (frame[4]) return request.finish(Error("XBee command failed (0x" + addressHex(frame.slice(4,5)) + ")."));
      if (request.onPart && frame.length > 5) return request.onPart(frame.subarray(5));
    }
    if (frame[0] === 0x8b && frame.length < 7) return;
    request.finish(null, frame);
  }

  async discover() {
    if (this.scan) return this.scan;
    this.scan = this.exchange([0x08, 0, 78, 68], 0x88, parseInt(this.info.NT, 16) * 100 + 1800, data => {
      if (data.length >= 10) this.onRadio(addressHex(data.subarray(2, 10)));
    });
    try { await this.scan; } finally { this.scan = null; }
  }

  async send(address, payload) {
    if (!/^[0-9A-F]{16}$/.test(address)) throw Error("Enter a 16-digit radio address.");
    // S2C can fragment API unicast payloads only.
    const limit = Math.min(parseInt(this.info.NP, 16), address === BROADCAST ? 84 : 255);
    if (!payload.length || payload.length > limit) throw Error("Send 1–" + limit + " bytes per message, including EOL.");
    const destination = address.match(/../g).map(byte => parseInt(byte, 16));
    const status = await this.exchange([0x10, 0, ...destination, 0xff, 0xfe, 0, 0, ...payload], 0x8b, 16000);
    if (status[5]) throw Error("Radio delivery failed (0x" + addressHex(status.slice(5,6)) + ").");
  }
}
