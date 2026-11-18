const headerSize = 12;
const blockSize = 64;
const magic = [0x89, 0x48, 0x49];
const view = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

function crc16(bytes) {
  let value = 0xffff;
  for (const byte of bytes) {
    value ^= byte << 8;
    for (let i = 0; i < 8; i++)
      value = ((value << 1) ^ (value & 0x8000 ? 0x1021 : 0)) & 0xffff;
  }
  return value;
}

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let i = 0; i < 8; i++)
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

export function isPictureReply(bytes) {
  return bytes.length >= headerSize + 3 && magic.every((b, i) => bytes[i] === b)
    && [0x49, 0x44, 0x45].includes(bytes[3]);
}

export class PictureDownload {
  constructor(radio, source) {
    this.radio = radio;
    this.source = source;
    this.id = crypto.getRandomValues(new Uint32Array(1))[0];
    this.retries = 0;
  }

  receive(source, bytes) {
    if (source !== this.source || !this.pending || !isPictureReply(bytes)) return;
    const data = view(bytes);
    if (data.getUint32(4, true) !== this.id || data.getUint32(8, true) !== this.offset) return;
    if (data.getUint16(bytes.length - 2, true) !== crc16(bytes.subarray(0, -2))) return;
    if (bytes[3] === 0x45 ? bytes.length === headerSize + 3 :
        bytes[3] === this.type && bytes.length === headerSize + this.length + 2)
      this.pending(bytes);
  }

  cancel() {
    this.cancelled = true;
    this.pending?.(null);
  }

  async request(command, offset, length) {
    const req = new Uint8Array(headerSize);
    req.set(magic);
    req[3] = command.charCodeAt(0);
    view(req).setUint32(4, this.id, true);
    view(req).setUint32(8, offset, true);
    this.type = command === "?" ? 0x49 : 0x44;
    this.offset = offset;
    this.length = length;
    for (let attempt = 0; attempt < 4 && !this.cancelled; attempt++) {
      if (attempt) this.retries++;
      let finish;
      const reply = new Promise(resolve => { finish = resolve; });
      this.pending = finish; // A response can precede the local TX status.
      try {
        await this.radio.send(this.source, req);
      } catch {
        finish(null);
      }
      const timer = setTimeout(() => finish(null), command === "?" ? 5000 : 1200);
      const bytes = await reply;
      clearTimeout(timer);
      this.pending = null;
      if (!bytes || this.cancelled) continue;
      if (bytes[3] === 0x45) {
        const reason = ["", "No picture_dl.jpg on the satellite SD card.",
          "Picture exceeds 1 MiB.", "Satellite could not read the picture."];
        throw Error(reason[bytes[headerSize]] || "Satellite picture error.");
      }
      return bytes.subarray(headerSize, -2);
    }
    if (this.cancelled) throw Error("Download cancelled.");
    if (command === "?") throw Error("No picture reply. Check the selected satellite and its Lab5-07 sketch.");
    throw Error("No verified reply at byte " + offset + ".");
  }

  async download(progress) {
    const info = view(await this.request("?", 0, 8));
    const size = info.getUint32(0, true);
    if (!size || size > 1024 * 1024) throw Error("Invalid picture size.");
    const file = new Uint8Array(size);
    progress(0, size);
    for (let offset = 0; offset < size; offset += blockSize) {
      const bytes = await this.request("R", offset, Math.min(blockSize, size - offset));
      file.set(bytes, offset);
      progress(offset + bytes.length, size);
    }
    if (crc32(file) !== info.getUint32(4, true)) throw Error("Picture checksum mismatch.");
    return file;
  }
}
