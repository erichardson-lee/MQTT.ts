import { decodeLength } from './length.ts';

import connect, { ConnectPacket } from './connect.ts';
import connack, { ConnackPacket } from './connack.ts';
import publish, { PublishPacket } from './publish.ts';
import puback, { PubackPacket } from './puback.ts';
import pubrec, { PubrecPacket } from './pubrec.ts';
import pubrel, { PubrelPacket } from './pubrel.ts';
import pubcomp, { PubcompPacket } from './pubcomp.ts';
import subscribe, { SubscribePacket } from './subscribe.ts';
import suback, { SubackPacket } from './suback.ts';
import unsubscribe, { UnsubscribePacket } from './unsubscribe.ts';
import unsuback, { UnsubackPacket } from './unsuback.ts';
import pingreq, { PingreqPacket } from './pingreq.ts';
import pingres, { PingresPacket } from './pingres.ts';
import disconnect, { DisconnectPacket } from './disconnect.ts';

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

export {
  ConnectPacket,
  ConnackPacket,
  PublishPacket,
  PubackPacket,
  PubrecPacket,
  PubrelPacket,
  PubcompPacket,
  SubscribePacket,
  SubackPacket,
  UnsubscribePacket,
  UnsubackPacket,
  PingreqPacket,
  PingresPacket,
  DisconnectPacket,
};

const packetTypesByName = {
  connect,
  connack,
  publish,
  puback,
  pubrec,
  pubrel,
  pubcomp,
  subscribe,
  suback,
  unsubscribe,
  unsuback,
  pingreq,
  pingres,
  disconnect,
};

const packetTypesById = [
  null,
  connect, // 1
  connack, // 2
  publish, // 3
  puback, // 4
  pubrec, // 5
  pubrel, // 6
  pubcomp, // 7
  subscribe, // 8
  suback, // 9
  unsubscribe, // 10
  unsuback, // 11
  pingreq, // 12
  pingres, // 13
  disconnect, // 14
];

export function encode(packet: AnyPacket): Uint8Array {
  const name = packet.type;
  const packetType: any = packetTypesByName[name];

  if (!packetType) {
    throw new Error(`packet type ${name} cannot be encoded`);
  }

  return Uint8Array.from(packetType.encode(packet));
}

export function decode(buffer: Uint8Array): AnyPacket | null {
  if (buffer.length < 2) {
    return null;
  }

  const id = buffer[0] >> 4;
  const packetType = packetTypesById[id];

  if (!packetType) {
    throw new Error(`packet type ${id} cannot be decoded`);
  }

  const { length: remainingLength, bytesUsedToEncodeLength } = decodeLength(
    buffer,
    1
  );

  if (buffer.length < 1 + bytesUsedToEncodeLength + remainingLength) {
    return null;
  }

  return packetType.decode(buffer, remainingLength);
}
