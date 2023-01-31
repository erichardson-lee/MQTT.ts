import { DecodedValue, EncodedValue } from "encoding/_types.ts";
import { decodeBinaryValue, encodeBinaryValue } from "encoding/binary.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeUTF8String(str: string): EncodedValue {
  const bytes = encoder.encode(str);

  return encodeBinaryValue(bytes);
}

export function decodeUTF8String(
  buffer: Uint8Array,
  startOffset: number,
): DecodedValue<string> {
  const { length, value, endOffset } = decodeBinaryValue(buffer, startOffset);

  return {
    length,
    endOffset,
    value: decoder.decode(value),
  };
}
