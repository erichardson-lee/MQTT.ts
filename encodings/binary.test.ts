import {
  decodeBinaryValue as decode,
  encodeBinaryValue as encode,
} from "encoding/binary.ts";
import { assertEquals } from "asserts";

Deno.test(function EncodeSmall() {
  const data = new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]);

  assertEquals(encode(data), [0x00, 0x04, 0xDE, 0xAD, 0xBE, 0xEF]);
});

Deno.test(function EncodeLarge() {
  const data = crypto.getRandomValues(
    new Uint8Array(64 * 1024 - 1 /** 64kb (-1b) random data */),
  );

  assertEquals(encode(data), [0xFF, 0xFF, ...data]);
});

Deno.test(function DecodeSmall() {
  const data = new Uint8Array([0x00, 0x04, 0xDE, 0xAD, 0xBE, 0xEF]);

  assertEquals(decode(data), {
    value: new Uint8Array([0xDE, 0xAD, 0xBE, 0xEF]),
    endOffset: 6,
    length: 6,
  });
});

Deno.test(function DecodeLarge() {
  const data = crypto.getRandomValues(
    new Uint8Array(64 * 1024 - 1 /** 64kb (-1b) random data */),
  );
  const input = new Uint8Array([0xFF, 0xFF, ...data]);

  assertEquals(decode(input), {
    value: data,
    endOffset: 0xFFFF + 2,
    length: 0xFFFF + 2,
  });
});
