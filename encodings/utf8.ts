import { DecodedValue, EncodedValue, EncodingPair } from "./_types.ts";
import { decodeBinaryValue, encodeBinaryValue } from "./binary.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder(undefined, { ignoreBOM: true });

// deno-lint-ignore no-control-regex
const MALFORMED_REGEX = /\x00|[\uD800-\uDFFF]/;

export function encodeUTF8String(data: string): EncodedValue {
  if (MALFORMED_REGEX.test(data)) throw new SyntaxError("Malformed String");
  if (data.length >= 64 * 1024) throw new SyntaxError("String Too Long");

  const bytes = encoder.encode(data);

  return encodeBinaryValue(bytes);
}

export function decodeUTF8String(
  buffer: Uint8Array,
  startOffset = 0,
): DecodedValue<string> {
  const { length, value, endOffset } = decodeBinaryValue(buffer, startOffset);

  return {
    length,
    endOffset,
    value: decoder.decode(value),
  };
}

export const Utf8String: EncodingPair<string> = {
  decode: decodeUTF8String,
  encode: encodeUTF8String,
};
