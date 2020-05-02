import {
  encode,
  decode,
  AnyPacket,
  ConnackPacket,
  PublishPacket,
  PubackPacket,
  PubrecPacket,
  PubrelPacket,
  PubcompPacket,
  SubackPacket,
  UnsubackPacket,
} from '../packets/mod.ts';

export type ClientOptions = {
  host?: string;
  port?: number;
  clientId?: string | Function;
  keepAlive?: number;
  username?: string;
  password?: string;
  connectTimeout?: number;
  reconnect?: boolean | ReconnectOptions;
};

export type ReconnectOptions = {
  min?: number;
  factor?: number;
  random?: boolean;
  max?: number;
  attempts?: number;
};

export type DefaultReconnectOptions = {
  min: number;
  factor: number;
  random: boolean;
  max: number;
  attempts: number;
};

export type PublishOptions = {
  dup?: boolean;
  qos?: 0 | 1 | 2;
  retain?: boolean;
};

type ConnectionStates =
  | 'never-connected'
  | 'connecting'
  | 'connect-failed'
  | 'connected'
  | 'offline'
  | 'reconnecting'
  | 'disconnecting'
  | 'disconnected';

const packetIdLimit = 2 ** 16;

export default abstract class Client {
  options: ClientOptions;
  clientId: string;
  keepAlive: number;
  connectionState: ConnectionStates;
  reconnectAttempt: number;
  lastPacketId: number;
  lastPacketTime: Date | undefined;
  incomingBuffer: Uint8Array | null = null;
  resolveConnect: any;
  rejectConnect: any;
  connectTimer: any;
  reconnectTimer: any;
  keepAliveTimer: any;
  unacknowledgedPublishes = new Map<
    number,
    {
      packet: PublishPacket;
      resolve: (val: PubackPacket) => void;
      reject: (err: Error) => void;
    }
  >();

  defaultClientIdPrefix: string = 'mqtt.ts';
  defaultConnectTimeout: number = 30 * 1000;
  defaultKeepAlive: number = 45;
  defaultReconnectOptions: DefaultReconnectOptions = {
    min: 1000,
    factor: 2,
    random: true,
    max: 60000,
    attempts: Infinity,
  };

  public constructor(options?: ClientOptions) {
    this.options = options || {};
    this.clientId = this.generateClientId();
    this.keepAlive = this.options.keepAlive || this.defaultKeepAlive;
    this.connectionState = 'never-connected';
    this.reconnectAttempt = 0;
    this.lastPacketId = 0;
  }

  // Public methods

  public connect(reconnecting?: boolean): Promise<ConnackPacket> {
    switch (this.connectionState) {
      case 'never-connected':
      case 'connect-failed':
      case 'offline':
      case 'disconnected':
        break;
      default:
        throw new Error(
          `should not be connecting in ${this.connectionState} state`
        );
    }

    this.changeState(reconnecting ? 'reconnecting' : 'connecting');

    return new Promise(async (resolve, reject) => {
      this.resolveConnect = resolve;
      this.rejectConnect = reject;

      try {
        await this.open();
      } catch (err) {
        this.connectionFailed();
      }
    });
  }

  public publish(topic: string, payload: any, options?: PublishOptions) {
    switch (this.connectionState) {
      case 'connected':
        break;
      default:
        throw new Error(
          `should not be publishing in ${this.connectionState} state`
        );
    }

    const qos = (options && options.qos) || 0;
    const id = qos > 0 ? this.nextPacketId() : 0;
    const packet: PublishPacket = {
      type: 'publish',
      dup: (options && options.dup) || false,
      retain: (options && options.retain) || false,
      topic,
      payload,
      qos,
      id,
    };

    this.send(packet);

    if (qos > 0) {
      return new Promise((resolve, reject) => {
        this.addUnacknowledgedPublishes(packet, resolve, reject);
      });
    }
  }

  public subscribe(topic: string, qos?: 0 | 1 | 2) {
    switch (this.connectionState) {
      case 'connected':
        break;
      default:
        throw new Error(
          `should not be subscribing in ${this.connectionState} state`
        );
    }

    this.send({
      type: 'subscribe',
      id: this.nextPacketId(),
      subscriptions: [{ topic, qos: qos || 0 }],
    });
  }

  public unsubscribe(topic: string) {
    switch (this.connectionState) {
      case 'connected':
        break;
      default:
        throw new Error(
          `should not be unsubscribing in ${this.connectionState} state`
        );
    }

    this.send({
      type: 'unsubscribe',
      id: this.nextPacketId(),
      topics: [topic],
    });
  }

  public disconnect() {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.keepAliveTimer) {
      clearTimeout(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }

    switch (this.connectionState) {
      case 'connected':
        break;
      default:
        throw new Error(
          `should not be disconnecting in ${this.connectionState} state`
        );
    }

    this.changeState('disconnecting');

    this.send({ type: 'disconnect' });

    this.close();
  }

  // Connection methods implemented by subclasses

  protected abstract async open(): Promise<void>;

  protected abstract async write(bytes: Uint8Array): Promise<void>;

  protected abstract async close(): Promise<void>;

  // Connection methods invoked by subclasses

  protected connectionOpened() {
    this.log('connectionOpened');

    this.startConnectTimer();

    this.send({
      type: 'connect',
      clientId: this.clientId,
      keepAlive: this.keepAlive,
      username: this.options.username,
      password: this.options.password,
    });
  }

  protected connectionFailed() {
    this.log('connectionFailed');

    this.stopConnectTimer();

    switch (this.connectionState) {
      case 'connecting':
      case 'reconnecting':
        if (this.connectionState === 'connecting') {
          this.reconnectAttempt = 0;
        } else {
          this.reconnectAttempt++;
        }

        this.changeState('connect-failed');
        this.startReconnectTimer();

        break;
      default:
        throw new Error(
          `connecting should not have failed in ${this.connectionState} state`
        );
    }
  }

  protected connectionClosed() {
    this.log('connectionClosed');

    this.stopKeepAliveTimer();

    switch (this.connectionState) {
      case 'disconnecting':
        this.changeState('disconnected');
        break;
      case 'connected':
        this.changeState('offline');
        this.reconnectAttempt = 0;
        this.startReconnectTimer();
        break;
      default:
        throw new Error(
          `connection should not be closing in ${this.connectionState} state`
        );
    }
  }

  protected connectionError(error: any) {
    // TODO: decide what to do with this
    this.log('connectionError', error);
  }

  protected bytesReceived(buffer: Uint8Array) {
    this.emit('bytesreceived', buffer);

    const bytes = this.incomingBuffer
      ? Uint8Array.from([...this.incomingBuffer, ...buffer])
      : buffer;

    const packet = this.decode(bytes);

    if (packet) {
      this.log(`received packet type ${packet.type}`);

      this.packetReceived(packet);

      this.incomingBuffer = null;
    } else {
      this.incomingBuffer = bytes;
    }
  }

  // Methods that can be overridden by subclasses

  protected packetReceived(packet: AnyPacket) {
    this.emit('packetreceive', packet);

    switch (packet.type) {
      case 'connack':
        this.handleConnack(packet);
        break;
      case 'publish':
        this.handlePublish(packet);
        break;
      case 'puback':
        this.handlePuback(packet);
        break;
      case 'pubrec':
        this.handlePubrec(packet);
        break;
      case 'pubrel':
        this.handlePubrel(packet);
        break;
      case 'pubcomp':
        this.handlePubcomp(packet);
        break;
      case 'suback':
        this.handleSuback(packet);
        break;
      case 'unsuback':
        this.handleUnsuback(packet);
        break;
    }
  }

  protected protocolViolation(msg: string) {
    this.log('protocolViolation', msg);
  }

  protected handleConnack(packet: ConnackPacket) {
    switch (this.connectionState) {
      case 'connecting':
      case 'reconnecting':
        break;
      default:
        throw new Error(
          `should not be receiving connack packets in ${this.connectionState} state`
        );
    }

    const wasConnecting = this.connectionState === 'connecting';

    this.changeState('connected');

    if (wasConnecting && this.resolveConnect) {
      this.resolveConnect(packet);
    }

    this.stopConnectTimer();
    this.startKeepAliveTimer();
  }

  protected handlePublish(packet: PublishPacket) {
    this.emit('message', packet);

    if (packet.qos === 1) {
      if (typeof packet.id !== 'number' || packet.id < 1) {
        return this.protocolViolation(
          'publish packet with qos 1 is missing id'
        );
      }

      this.send({
        type: 'puback',
        id: packet.id,
      });
    } else if (packet.qos === 2) {
      if (typeof packet.id !== 'number' || packet.id < 1) {
        return this.protocolViolation(
          'publish packet with qos 2 is missing id'
        );
      }

      this.send({
        type: 'pubrec',
        id: packet.id,
      });
    }
  }

  protected handlePuback(packet: PubackPacket) {
    const ack = this.unacknowledgedPublishes.get(packet.id);

    if (ack) {
      const { resolve } = ack;
      this.unacknowledgedPublishes.delete(packet.id);
      resolve(packet);
    }
  }

  protected handlePubrec(packet: PubrecPacket) {
    // TODO: mark message as received
    this.send({
      type: 'pubrel',
      id: packet.id,
    });
  }

  protected handlePubrel(packet: PubrelPacket) {
    // TODO: mark message as released
    this.send({
      type: 'pubcomp',
      id: packet.id,
    });
  }

  protected handlePubcomp(_packet: PubcompPacket) {
    // TODO: mark message as completely acknowledged
  }

  protected handleSuback(_packet: SubackPacket) {
    // TODO: mark subscription as acknowledged
  }

  protected handleUnsuback(_packet: UnsubackPacket) {
    // TODO: mark unsubscription as acknowledged
  }

  protected startConnectTimer() {
    this.connectTimer = setTimeout(() => {
      if (this.connectionState !== 'connected') {
        const wasConnecting = this.connectionState === 'connecting';

        this.changeState('connect-failed');

        if (wasConnecting) {
          this.reconnectAttempt = 0;

          this.rejectConnect(new Error('connect timed out'));
        }

        this.startReconnectTimer();
      } else {
        this.log('connectTimer should have been cancelled');
      }
    }, this.options.connectTimeout || this.defaultConnectTimeout);
  }

  protected stopConnectTimer() {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  protected startKeepAliveTimer() {
    // This method doesn't get called until after receiving the connack packet
    // so this.lastPacketTime should have a value.
    const elapsed = Date.now() - this.lastPacketTime!.getTime();
    const timeout = this.keepAlive * 1000 - elapsed;

    this.keepAliveTimer = setTimeout(() => this.sendKeepAlive(), timeout);
  }

  protected stopKeepAliveTimer() {
    if (this.keepAliveTimer) {
      clearTimeout(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  protected sendKeepAlive() {
    if (this.connectionState === 'connected') {
      const elapsed = Date.now() - this.lastPacketTime!.getTime();
      const timeout = this.keepAlive * 1000;

      if (elapsed >= timeout) {
        this.send({
          type: 'pingreq',
        });
      }

      this.startKeepAliveTimer();
    } else {
      this.log('keepAliveTimer should have been cancelled');
    }
  }

  protected startReconnectTimer() {
    const options = this.options;

    if (options.reconnect === false) {
      return;
    }

    const defaultReconnectOptions = this.defaultReconnectOptions;

    const reconnectOptions =
      typeof options.reconnect === 'object'
        ? options.reconnect
        : defaultReconnectOptions;

    const attempt = this.reconnectAttempt;
    const maxAttempts =
      reconnectOptions.attempts || defaultReconnectOptions.attempts;

    if (attempt >= maxAttempts) {
      return;
    }

    // https://dthain.blogspot.com/2009/02/exponential-backoff-in-distributed.html
    const min = reconnectOptions.min || defaultReconnectOptions.min;
    const factor = reconnectOptions.factor || defaultReconnectOptions.factor;
    const random = 1 + (reconnectOptions.random ? Math.random() : 0);
    const max = reconnectOptions.max || defaultReconnectOptions.max;

    const delay = Math.min(min * Math.pow(factor, attempt) * random, max);

    this.log(`reconnecting in ${delay}ms`);

    this.reconnectTimer = setTimeout(() => {
      this.connect(true);
    }, delay);
  }

  addUnacknowledgedPublishes(
    packet: PublishPacket,
    resolve: (val: PubackPacket) => void,
    reject: (err: Error) => void
  ) {
    this.unacknowledgedPublishes.set(packet.id!, { packet, resolve, reject });
  }

  // Utility methods

  protected changeState(newState: ConnectionStates) {
    const oldState = this.connectionState;

    this.connectionState = newState;

    this.emit('statechange', { from: oldState, to: newState });

    this.emit(newState);
  }

  protected generateClientId() {
    let clientId;

    if (typeof this.options.clientId === 'string') {
      clientId = this.options.clientId;
    } else if (typeof this.options.clientId === 'function') {
      clientId = this.options.clientId();
    }

    if (!clientId) {
      const prefix = this.defaultClientIdPrefix;
      const suffix = Math.random().toString(36).slice(2);

      clientId = `${prefix}-${suffix}`;
    }

    return clientId;
  }

  protected nextPacketId() {
    this.lastPacketId = (this.lastPacketId + 1) % packetIdLimit;

    // Don't allow packet id to be 0.
    if (!this.lastPacketId) {
      this.lastPacketId = 1;
    }

    return this.lastPacketId;
  }

  protected send(packet: AnyPacket) {
    this.log(`sending packet type ${packet.type}`);

    this.emit('packetsend', packet);

    const bytes = this.encode(packet);

    this.emit('bytessent', bytes);

    this.write(bytes);

    this.lastPacketTime = new Date();
  }

  protected encode(packet: AnyPacket): Uint8Array {
    return encode(packet);
  }

  protected decode(bytes: Uint8Array): AnyPacket | null {
    return decode(bytes);
  }

  protected emit(event: string, data?: any) {
    // if (typeof this.options[`on${event}`] === 'function') {
    //   this.options[`on${event}`](data);
    // }
  }

  protected log(...args: unknown[]) {
    console.log(...args);
  }
}
