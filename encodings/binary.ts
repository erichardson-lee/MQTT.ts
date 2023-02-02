import { DecodedValue, EncodedValue, EncodingPair } from "./_types.ts";

export function encodeBinaryValue(bytes: Uint8Array): EncodedValue {
  return [bytes.length >> 8, bytes.length & 0xff, ...bytes];
}

export function decodeBinaryValue(
  buffer: Uint8Array,
  startOffset = 0,
): DecodedValue<Uint8Array> {
  const length = (buffer[startOffset] << 8) + buffer[startOffset + 1];
  const bytes = buffer.subarray(startOffset + 2, startOffset + 2 + length);

  return {
    value: bytes,
    length: length + 2,
    endOffset: startOffset + 2 + length,
  };
}

export const Binary: EncodingPair<Uint8Array> = {
  decode: decodeBinaryValue,
  encode: encodeBinaryValue,
};
