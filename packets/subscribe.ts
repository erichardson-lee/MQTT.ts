import { QoS } from '../lib/mod.ts';
import { encodeLength } from './length.ts';
import {
  UTF8Encoder,
  UTF8Decoder,
  encodeUTF8String,
  decodeUTF8String,
} from './utf8.ts';

export interface SubscribePacket {
  type: 'subscribe';
  id: number;
  subscriptions: Subscription[];
}

export type Subscription = {
  topic: string;
  qos: QoS;
};

export default {
  encode(packet: SubscribePacket, utf8Encoder: UTF8Encoder) {
    const packetType = 8;
    const flags = 0b0010; // bit 2 must be 1 in 3.1.1

    const variableHeader = [packet.id >> 8, packet.id & 0xff];

    const payload = [];

    for (const sub of packet.subscriptions) {
      payload.push(...encodeUTF8String(sub.topic, utf8Encoder), sub.qos);
    }

    const fixedHeader = [
      (packetType << 4) | flags,
      ...encodeLength(variableHeader.length + payload.length),
    ];

    return [...fixedHeader, ...variableHeader, ...payload];
  },

  decode(
    buffer: Uint8Array,
    remainingStart: number,
    _remainingLength: number,
    utf8Decoder: UTF8Decoder
  ): SubscribePacket {
    const idStart = remainingStart;
    const id = (buffer[idStart] << 8) + buffer[idStart + 1];

    const subscriptionsStart = idStart + 2;
    const subscriptions: Subscription[] = [];

    for (let i = subscriptionsStart; i < buffer.length; ) {
      const topic = decodeUTF8String(buffer, i, utf8Decoder);
      i += topic.length;

      const qos = buffer[i];
      i += 1;

      if (qos !== 0 && qos !== 1 && qos !== 2) {
        throw new Error('invalid qos');
      }

      subscriptions.push({
        topic: topic.value,
        qos,
      });
    }

    return {
      type: 'subscribe',
      id,
      subscriptions,
    };
  },
};
