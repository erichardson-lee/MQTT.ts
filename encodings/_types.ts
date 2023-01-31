export type DecodedValue<T> = { value: T; endOffset: number; length: number };
export type EncodedValue = number[];

// Disable linting for this line because we want to allow any encoding to be
// used as a value.
// deno-lint-ignore no-explicit-any
export type EncodingPair<T = any> = {
  encode: (value: T) => EncodedValue;
  decode: (buffer: Uint8Array, startOffset?: number) => DecodedValue<T>;
};
