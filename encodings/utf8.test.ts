import { assertEquals, assertThrows } from "asserts";
import {
  decodeUTF8String as decode,
  encodeUTF8String as encode,
} from "encoding/utf8.ts";

const SimpleButInHex = [
  0x53, // S
  0x69, // i
  0x6d, // m
  0x70, // p
  0x6c, // l
  0x65, // e
  0x42, // B
  0x75, // u
  0x74, // t
  0x49, // I
  0x6e, // n
  0x48, // H
  0x65, // e
  0x78, // x
] as const;

Deno.test(function simpleEncode() {
  assertEquals(encode("SimpleButInHex"), [0, 14, ...SimpleButInHex]);
});

Deno.test(function simpleDecode() {
  assertEquals(
    decode(new Uint8Array([0, 14, ...SimpleButInHex])),
    { value: "SimpleButInHex", endOffset: 16, length: 16 },
  );
});

Deno.test("Normative Statement [MQTT-1.5.4-1]", () => {
  //The character data in a UTF-8 Encoded String MUST be well-formed UTF-8 as
  // defined by the Unicode specification [Unicode] and restated in RFC 3629.
  // In particular, the character data MUST NOT include encodings of code points
  // between U+D800 and U+DFFF.

  assertThrows(() => encode("InvalidString\uD800"));
  assertThrows(() => encode("InvalidString\uDFFF"));
  // Random Unicode char between d800 and dfff
  assertThrows(() => encode("InvalidString\uD920"));
});

Deno.test("Normative Statement [MQTT-1.5.4-2]", () => {
  // A UTF-8 Encoded String MUST NOT include an encoding of the null character
  // U+0000.

  assertThrows(() => encode("InvalidString\u0000"));
});

Deno.test("Normative Statement [MQTT-1.5.4-3]", () => {
  // A UTF-8 encoded sequence 0xEF 0xBB 0xBF is always interpreted as U+FEFF
  // ("ZERO WIDTH NO-BREAK SPACE") wherever it appears in a string and MUST NOT be
  // skipped over or stripped off by a packet receiver.

  // The Word 'Test' the sequence above, then 'Test', then the sequence in hex utf-8
  const value = [
    0xEF, //
    0xBB, // Hex Sequence
    0xBF, //
    84, // T
    101, // e
    115, // s
    116, // t
    0xEF, //
    0xBB, // Hex Sequence
    0xBF, //
    84, // T
    101, // e
    115, // s
    116, // t
    0xEF, //
    0xBB, // Hex Sequence
    0xBF, //
  ] as const;

  assertEquals(
    decode(new Uint8Array([0x00, value.length, ...value])),
    {
      value: "\uFEFFTest\uFEFFTest\uFEFF",
      endOffset: value.length + 2,
      length: value.length + 2,
    },
  );
  "))";
});
