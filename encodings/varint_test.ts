import { assertEquals } from "asserts";
import { decodeLength as decode, encodeLength as encode } from "./varint.ts";

Deno.test("encodeLength", function encodeLength() {
  assertEquals(encode(0), [0x00]);
  assertEquals(encode(127), [0x7f]);
  assertEquals(encode(128), [0x80, 0x01]);
  assertEquals(encode(16_383), [0xff, 0x7f]);
  assertEquals(encode(16_384), [0x80, 0x80, 0x01]);
  assertEquals(encode(2_097_151), [0xff, 0xff, 0x7f]);
  assertEquals(encode(2_097_152), [0x80, 0x80, 0x80, 0x01]);
  assertEquals(encode(268_435_455), [0xff, 0xff, 0xff, 0x7f]);
});

Deno.test("decodeLength", function decodeLength() {
  assertEquals(decode(Uint8Array.from([0x00]), 0), {
    value: 0,
    endOffset: 1,
  });
  assertEquals(decode(Uint8Array.from([0x7f]), 0), {
    value: 127,
    endOffset: 1,
  });
  assertEquals(decode(Uint8Array.from([0x80, 0x01]), 0), {
    value: 128,
    endOffset: 2,
  });
  assertEquals(decode(Uint8Array.from([0xff, 0x7f]), 0), {
    value: 16_383,
    endOffset: 2,
  });
  assertEquals(decode(Uint8Array.from([0x80, 0x80, 0x01]), 0), {
    value: 16_384,
    endOffset: 3,
  });
  assertEquals(decode(Uint8Array.from([0xff, 0xff, 0x7f]), 0), {
    value: 2_097_151,
    endOffset: 3,
  });
  assertEquals(decode(Uint8Array.from([0x80, 0x80, 0x80, 0x01]), 0), {
    value: 2_097_152,
    endOffset: 4,
  });
  assertEquals(decode(Uint8Array.from([0xff, 0xff, 0xff, 0x7f]), 0), {
    value: 268_435_455,
    endOffset: 4,
  });
});
