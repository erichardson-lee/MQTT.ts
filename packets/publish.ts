import { encodeVarInt } from "../encodings/varint.ts";
import { decodeUTF8String, encodeUTF8String } from "../encodings/utf8.ts";

export interface PublishPacket {
  type: "publish";
  topic: string;
  payload: PublishPayload;
  dup: boolean;
  retain: boolean;
  qos: 0 | 1 | 2;
  id: number;
}

export type PublishPayload = string | Uint8Array;

export function encode(packet: PublishPacket) {
  const packetType = 3;

  const qos = packet.qos || 0;

  const flags = (packet.dup ? 8 : 0) +
    (qos & 2 ? 4 : 0) +
    (qos & 1 ? 2 : 0) +
    (packet.retain ? 1 : 0);

  const variableHeader = [...encodeUTF8String(packet.topic)];

  if (qos === 1 || qos === 2) {
    if (typeof packet.id !== "number" || packet.id < 1) {
      throw new Error("when qos is 1 or 2, packet must have id");
    }

    variableHeader.push(packet.id >> 8, packet.id & 0xff);
  }

  let payload = packet.payload;

  if (typeof payload === "string") {
    payload = new TextEncoder().encode(payload);
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
  remainingLength: number,
): PublishPacket {
  const flags = buffer[0] & 0x0f;

  const dup = !!(flags & 8);
  const qos = (flags & 6) >> 1;
  const retain = !!(flags & 1);

  if (qos !== 0 && qos !== 1 && qos !== 2) {
    throw new Error("invalid qos");
  }

  const topicStart = remainingStart;
  const decodedTopic = decodeUTF8String(buffer, topicStart);
  const topic = decodedTopic.value;

  let id = 0;
  let payloadStart = topicStart + decodedTopic.length;

  if (qos > 0) {
    const idStart = payloadStart;

    id = (buffer[idStart] << 8) + buffer[idStart + 1];

    payloadStart += 2;
  }

  const payload = buffer.subarray(
    payloadStart,
    remainingStart + remainingLength,
  );

  return {
    type: "publish",
    topic,
    payload,
    dup,
    retain,
    qos,
    id,
  };
}
