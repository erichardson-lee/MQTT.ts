export function encodeLength(val: number): number[] {
  if (val < 0) throw new SyntaxError("Value Out Of Range", { cause: val });

  if (val < 128) return [val];

  const b1 = val & 0x7F;
  const b2 = (val >> 7) & 0x7F;

  if (val < 16_384) return [b1 | 0x80, b2];

  const b3 = (val >> 14) & 0x7F;

  if (val < 2_097_152) return [b1 | 0x80, b2 | 0x80, b3];

  const b4 = (val >> 21);

  if (val < 268_435_456) return [b1 | 0x80, b2 | 0x80, b3 | 0x80, b4];

  throw new SyntaxError("Value Out Of Range", { cause: val });
}

export function decodeLength(data: Uint8Array, offset: number) {
  const b1 = data[offset];

  if ((b1 & 0x80) === 0) {
    return {
      // Functionally equivalent to returning ((b1 & 0x7f) << 0)
      value: b1,
      endOffset: offset + 1,
    };
  }

  const b2 = data[offset + 1];

  if ((b2 & 0x80) === 0) {
    return {
      value: ((b1 & 0x7F) << 0) |
        ((b2 & 0x7F) << 7),
      endOffset: offset + 2,
    };
  }

  const b3 = data[offset + 2];

  if ((b3 & 0x80) === 0) {
    return {
      value: ((b1 & 0x7F) << 0) |
        ((b2 & 0x7F) << 7) |
        ((b3 & 0x7F) << 14),
      endOffset: offset + 3,
    };
  }

  const b4 = data[offset + 3];

  if ((b4 & 0x80) === 0) {
    return {
      value: ((b1 & 0x7F) << 0) |
        ((b2 & 0x7F) << 7) |
        ((b3 & 0x7F) << 14) |
        ((b4 & 0x7F) << 21),
      endOffset: offset + 4,
    };
  }

  throw new Error("Malformed Variable Byte Integer");
}
