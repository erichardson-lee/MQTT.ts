import type { ConnackPacket } from "./connack.ts";
import { decode as connackDecoder } from "./connack.ts";
import type { ConnectPacket } from "./connect.ts";
import { decode as connectDecoder } from "./connect.ts";
import type { DisconnectPacket } from "./disconnect.ts";
import { decode as disconnectDecoder } from "./disconnect.ts";
import { decodeVarInt } from "../encodings/varint.ts";
import type { PingreqPacket } from "./pingreq.ts";
import { decode as pingreqDecoder } from "./pingreq.ts";
import type { PingresPacket } from "./pingres.ts";
import { decode as pingresDecoder } from "./pingres.ts";
import type { PubackPacket } from "./puback.ts";
import { decode as pubackDecoder } from "./puback.ts";
import type { PubcompPacket } from "./pubcomp.ts";
import { decode as pubcompDecoder } from "./pubcomp.ts";
import type { PublishPacket } from "./publish.ts";
import { decode as publishDecoder } from "./publish.ts";
import type { PubrecPacket } from "./pubrec.ts";
import { decode as pubrecDecoder } from "./pubrec.ts";
import type { PubrelPacket } from "./pubrel.ts";
import { decode as pubrelDecoder } from "./pubrel.ts";
import type { SubackPacket } from "./suback.ts";
import { decode as subackDecoder } from "./suback.ts";
import type { SubscribePacket } from "./subscribe.ts";
import { decode as subscribeDecoder } from "./subscribe.ts";
import type { UnsubackPacket } from "./unsuback.ts";
import { decode as unsubackDecoder } from "./unsuback.ts";
import type { UnsubscribePacket } from "./unsubscribe.ts";
import { decode as unsubscribeDecoder } from "./unsubscribe.ts";

export type AnyPacket =
  | ConnectPacket
  | ConnackPacket
  | PublishPacket
  | PubackPacket
  | PubrecPacket
  | PubrelPacket
  | PubcompPacket
  | SubscribePacket
  | SubackPacket
  | UnsubscribePacket
  | UnsubackPacket
  | PingreqPacket
  | PingresPacket
  | DisconnectPacket;

export type AnyPacketWithLength = AnyPacket & { length: number };

export type {
  ConnackPacket,
  ConnectPacket,
  DisconnectPacket,
  PingreqPacket,
  PingresPacket,
  PubackPacket,
  PubcompPacket,
  PublishPacket,
  PubrecPacket,
  PubrelPacket,
  SubackPacket,
  SubscribePacket,
  UnsubackPacket,
  UnsubscribePacket,
};

export type PacketEncoder<T> = (
  packet: T,
) => Uint8Array;

export type PacketDecoder<T> = (
  packet: Uint8Array,
  remainingStart: number,
  remainingLength: number,
) => T;

const packetDecoders = [
  null,
  connectDecoder, // 1
  connackDecoder, // 2
  publishDecoder, // 3
  pubackDecoder, // 4
  pubrecDecoder, // 5
  pubrelDecoder, // 6
  pubcompDecoder, // 7
  subscribeDecoder, // 8
  subackDecoder, // 9
  unsubscribeDecoder, // 10
  unsubackDecoder, // 11
  pingreqDecoder, // 12
  pingresDecoder, // 13
  disconnectDecoder, // 14
];

export function decode(
  buffer: Uint8Array,
): AnyPacketWithLength | null {
  if (buffer.length < 2) {
    return null;
  }

  const id = buffer[0] >> 4;

  const decoder = packetDecoders[id];

  if (!decoder) {
    throw new Error(`packet type ${id} cannot be decoded`);
  }

  const { value: remainingLength, endOffset } = decodeVarInt(
    buffer,
    1,
  );

  const packetLength = endOffset + remainingLength;

  if (buffer.length < packetLength) {
    throw new Error(`Buffer too short for packet`);
  }

  const packet = decoder(
    buffer,
    endOffset,
    remainingLength,
  );

  if (!packet) {
    return null;
  }

  const packetWithLength = packet as AnyPacketWithLength;

  packetWithLength.length = packetLength;

  return packetWithLength;
}
