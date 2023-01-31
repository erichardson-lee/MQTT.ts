Deno.bench({
  name: "Expand Loop",
  group: "encode",
  baseline: true,
}, () => {
  const val = 268_435_455;

  if (val < 0) throw new SyntaxError("Value Out Of Range", { cause: val });

  if (val < 128) {
    return void [val];
  }

  const b1 = val & 0x7F;
  const b2 = (val >> 7) & 0x7F;

  if (val < 16_384) {
    return void [b1 | 0x80, b2];
  }

  const b3 = (val >> 14) & 0x7F;

  if (val < 2_097_152) {
    return void [b1 | 0x80, b2 | 0x80, b3];
  }

  const b4 = (val >> 21);

  if (val < 268_435_456) {
    return void [b1 | 0x80, b2 | 0x80, b3 | 0x80, b4];
  }

  throw new SyntaxError("Value Out Of Range", { cause: val });
});

Deno.bench({
  name: "@jdiamond/mqtt.ts implementation",
  group: "encode",
}, () => {
  let x = 268_435_455;

  const output = [];

  do {
    let encodedByte = x % 128;

    x = Math.floor(x / 128);

    if (x > 0) {
      encodedByte = encodedByte | 128;
    }

    output.push(encodedByte);
  } while (x > 0);
});

const data = new Uint8Array([0xFF, 0xFF, 0xFF, 0x7F]);

Deno.bench({
  name: "Expand Loop",
  group: "decode",
  baseline: true,
}, () => {
  const offset = 0;

  const b1 = data[offset];

  if ((b1 & 0x80) === 0) {
    return void {
      // Functionally equivalent to returning ((b1 & 0x7f) << 0)
      value: b1,
      endOffset: offset + 1,
    };
  }

  const b2 = data[offset + 1];

  if ((b2 & 0x80) === 0) {
    return void {
      value: ((b1 & 0x7F) << 0) |
        ((b2 & 0x7F) << 7),
      endOffset: offset + 2,
    };
  }

  const b3 = data[offset + 2];

  if ((b3 & 0x80) === 0) {
    return void {
      value: ((b1 & 0x7F) << 0) |
        ((b2 & 0x7F) << 7) |
        ((b3 & 0x7F) << 14),
      endOffset: offset + 3,
    };
  }

  const b4 = data[offset + 3];

  if ((b4 & 0x80) === 0) {
    return void {
      value: ((b1 & 0x7F) << 0) |
        ((b2 & 0x7F) << 7) |
        ((b3 & 0x7F) << 14) |
        ((b4 & 0x7F) << 21),
      endOffset: offset + 4,
    };
  }

  throw new Error("Malformed Variable Byte Integer");
});

Deno.bench({
  name: "@jdiamond/mqtt.ts implementation",
  group: "decode",
}, () => {
  const startIndex = 0;
  let i = startIndex;
  let encodedByte = 0;
  let value = 0;
  let multiplier = 1;

  do {
    encodedByte = data[i++];

    value += (encodedByte & 127) * multiplier;

    if (multiplier > 128 * 128 * 128) {
      throw Error("malformed length");
    }

    multiplier *= 128;
  } while ((encodedByte & 128) != 0);

  return void { value, endOffset: i - startIndex };
});
