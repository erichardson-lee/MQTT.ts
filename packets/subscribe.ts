import { QoS } from "../lib/mod.ts";
import { encodeVarInt } from "../encodings/varint.ts";
import { decodeUTF8String, encodeUTF8String } from "../encodings/utf8.ts";

export interface SubscribePacket {
  type: "subscribe";
  id: number;
  subscriptions: Subscription[];
}

export type Subscription = {
  topicFilter: string;
  qos: QoS;
};

export function encode(packet: SubscribePacket) {
  const packetType = 8;
  const flags = 0b0010; // bit 2 must be 1 in 3.1.1

  const variableHeader = [packet.id >> 8, packet.id & 0xff];

  const payload = [];

  for (const sub of packet.subscriptions) {
    payload.push(...encodeUTF8String(sub.topicFilter), sub.qos);
  }

  const fixedHeader = [
    (packetType << 4) | flags,
    ...encodeVarInt(variableHeader.length + payload.length),
  ];

  return Uint8Array.from([...fixedHeader, ...variableHeader, ...payload]);
}

export function decode(
  buffer: Uint8Array,
  remainingStart: number,
  _remainingLength: number,
): SubscribePacket {
  const idStart = remainingStart;
  const id = (buffer[idStart] << 8) + buffer[idStart + 1];

  const subscriptionsStart = idStart + 2;
  const subscriptions: Subscription[] = [];

  for (let i = subscriptionsStart; i < buffer.length;) {
    const topicFilter = decodeUTF8String(buffer, i);
    i += topicFilter.length;

    const qos = buffer[i];
    i += 1;

    if (qos !== 0 && qos !== 1 && qos !== 2) {
      throw new Error("invalid qos");
    }

    subscriptions.push({
      topicFilter: topicFilter.value,
      qos,
    });
  }

  return {
    type: "subscribe",
    id,
    subscriptions,
  };
}
