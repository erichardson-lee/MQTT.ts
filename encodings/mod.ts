import { Binary } from "./binary.ts";
import { Utf8String } from "./utf8.ts";
import { VarInt } from "./varint.ts";
import { EncodingPair } from "./_types.ts";

export const Encodings = {
  Binary,
  Utf8String,
  VarInt,
} satisfies { [method: string]: EncodingPair };
