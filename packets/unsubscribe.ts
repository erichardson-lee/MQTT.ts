import { encodeVarInt } from "../encodings/varint.ts";
import { decodeUTF8String, encodeUTF8String } from "../encodings/utf8.ts";

export interface UnsubscribePacket {
  type: "unsubscribe";
  id: number;
  topicFilters: string[];
}

export function encode(packet: UnsubscribePacket) {
  const packetType = 0b1010;
  const flags = 0b0010;

  const variableHeader = [packet.id >> 8, packet.id & 0xff];

  const payload = [];

  for (const topic of packet.topicFilters) {
    payload.push(...encodeUTF8String(topic));
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
): UnsubscribePacket {
  const idStart = remainingStart;
  const id = (buffer[idStart] << 8) + buffer[idStart + 1];

  const topicFiltersStart = idStart + 2;
  const topicFilters: string[] = [];

  for (let i = topicFiltersStart; i < buffer.length;) {
    const topicFilter = decodeUTF8String(buffer, i);
    i += topicFilter.length;

    topicFilters.push(topicFilter.value);
  }

  return {
    type: "unsubscribe",
    id,
    topicFilters,
  };
}
