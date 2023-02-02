import { DecodedValue, EncodedValue, EncodingPair } from "./_types.ts";

export function encodeVarInt(val: number): EncodedValue {
  if (val < 0) throw new SyntaxError("Value Out Of Range", { cause: val });

  if (val < 128) return [val];

  const b1 = val & 0x7F;
  const b2 = (val >> 7) & 0x7F;

  if (val < 16_384) return [b1 | 0x80, b2];

  const b3 = (val >> 14) & 0x7F;

  if (val < 2_097_152) return [b1 | 0x80, b2 | 0x80, b3];

  const b4 = val >> 21;

  if (val < 268_435_456) return [b1 | 0x80, b2 | 0x80, b3 | 0x80, b4];

  throw new SyntaxError("Value Out Of Range", { cause: val });
}

export function decodeVarInt(
  buffer: Uint8Array,
  startOffset = 0,
): DecodedValue<number> {
  const b1 = buffer[startOffset];

  if ((b1 & 0x80) === 0) {
    return {
      // Functionally equivalent to returning ((b1 & 0x7f) << 0)
      value: b1,
      length: 1,
      endOffset: startOffset + 1,
    };
  }

  const b2 = buffer[startOffset + 1];

  if ((b2 & 0x80) === 0) {
    return {
      value: ((b1 & 0x7F) << 0) |
        ((b2 & 0x7F) << 7),
      length: 2,
      endOffset: startOffset + 2,
    };
  }

  const b3 = buffer[startOffset + 2];

  if ((b3 & 0x80) === 0) {
    return {
      value: ((b1 & 0x7F) << 0) |
        ((b2 & 0x7F) << 7) |
        ((b3 & 0x7F) << 14),
      length: 3,
      endOffset: startOffset + 3,
    };
  }

  const b4 = buffer[startOffset + 3];

  if ((b4 & 0x80) === 0) {
    return {
      value: ((b1 & 0x7F) << 0) |
        ((b2 & 0x7F) << 7) |
        ((b3 & 0x7F) << 14) |
        ((b4 & 0x7F) << 21),
      length: 4,
      endOffset: startOffset + 4,
    };
  }

  throw new Error("Malformed Variable Byte Integer");
}

export const VarInt: EncodingPair<number> = {
  decode: decodeVarInt,
  encode: encodeVarInt,
};
