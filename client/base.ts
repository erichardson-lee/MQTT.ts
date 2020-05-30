import { QoS } from '../lib/mod.ts';
import {
  encode,
  decode,
  AnyPacket,
  AnyPacketWithLength,
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
} from '../packets/mod.ts';
import { UTF8Encoder, UTF8Decoder } from '../packets/utf8.ts';

type URLFactory = URL | string | (() => URL | string | void);
type ClientIdFactory = string | (() => string);

export type BaseClientOptions = {
  url?: URLFactory;
  clientId?: ClientIdFactory;
  clientIdPrefix?: string;
  clean?: boolean;
  keepAlive?: number;
  username?: string;
  password?: string;
  connectTimeout?: number;
  connect?: boolean | RetryOptions;
  reconnect?: boolean | RetryOptions;
  logger?: (msg: string, ...args: unknown[]) => void;
};

export type RetryOptions = {
  retries?: number;
  minDelay?: number;
  maxDelay?: number;
  factor?: number;
  random?: boolean;
};

export type PublishOptions = {
  dup?: boolean;
  qos?: QoS;
  retain?: boolean;
};

export type SubscriptionOption = {
  topic: string;
  qos?: QoS;
};

export type Subscription = {
  topic: string;
  qos: QoS;
  state:
    | 'pending'
    | 'removed'
    | 'replaced'
    | 'unacknowledged'
    | 'acknowledged'
    | 'unsubscribe-pending'
    | 'unsubscribe-unacknowledged'
    | 'unsubscribe-acknowledged';
  returnCode?: number;
};

type ConnectionStates =
  | 'offline'
  | 'connecting'
  | 'waiting-for-connack'
  | 'connected'
  | 'disconnecting'
  | 'disconnected';

const packetIdLimit = 2 ** 16;

const defaultPorts: { [protocol: string]: number } = {
  mqtt: 1883,
  mqtts: 8883,
  ws: 80,
  wss: 443,
};

const defaultClientIdPrefix = 'mqttts';
const defaultKeepAlive = 60;
const defaultConnectTimeout = 10 * 1000;
const defaultConnectOptions = {
  retries: Infinity,
  minDelay: 1000,
  maxDelay: 2000,
  factor: 1.1,
  random: false,
};
const defaultReconnectOptions = {
  retries: Infinity,
  minDelay: 1000,
  maxDelay: 60000,
  factor: 1.1,
  random: true,
};

export abstract class BaseClient<OptionsType extends BaseClientOptions> {
  options: OptionsType;
  url?: URL;
  clientId: string;
  keepAlive: number;
  connectionState: ConnectionStates = 'offline';
  everConnected: boolean = false;
  disconnectRequested: boolean = false;
  reconnectAttempt: number = 0;
  subscriptions: Subscription[] = [];

  private lastPacketId: number = 0;
  private lastPacketTime: Date | undefined;

  private buffer: Uint8Array | null = null;

  queuedPackets: AnyPacket[] = [];

  unacknowledgedConnect?: Deferred<ConnackPacket>;

  private unacknowledgedPublishes = new Map<number, Deferred<void>>();
  private unresolvedSubscribes = new Map<
    string,
    Deferred<SubackPacket | null>
  >();
  private unresolvedUnsubscribes = new Map<
    string,
    Deferred<UnsubackPacket | null>
  >();
  private unacknowledgedSubscribes = new Map<
    number,
    {
      subscriptions: Subscription[];
    }
  >();
  private unacknowledgedUnsubscribes = new Map<
    number,
    {
      subscriptions: (Subscription | undefined)[];
    }
  >();

  eventListeners: Map<string, Function[]> = new Map();

  private timers: {
    [key: string]: any | undefined;
  } = {};

  log: (msg: string, ...args: unknown[]) => void;

  public constructor(options?: OptionsType) {
    this.options = options || <OptionsType>{};
    this.clientId = this.generateClientId();
    this.keepAlive =
      typeof this.options.keepAlive === 'number'
        ? this.options.keepAlive
        : defaultKeepAlive;
    this.log = this.options.logger || (() => {});
  }

  public async connect(): Promise<ConnackPacket> {
    switch (this.connectionState) {
      case 'offline':
      case 'disconnected':
        break;
      default:
        throw new Error(
          `should not be connecting in ${this.connectionState} state`
        );
    }

    this.disconnectRequested = false;

    const deferred = new Deferred<ConnackPacket>();

    this.unacknowledgedConnect = deferred;

    this.openConnection();

    return deferred.promise;
  }

  public async publish(
    topic: string,
    payload: any,
    options?: PublishOptions
  ): Promise<void> {
    const dup = (options && options.dup) || false;
    const qos = (options && options.qos) || 0;
    const retain = (options && options.retain) || false;
    const id = qos > 0 ? this.nextPacketId() : 0;

    const packet: PublishPacket = {
      type: 'publish',
      dup,
      qos,
      retain,
      topic,
      payload,
      id,
    };

    let result = undefined;

    if (qos > 0) {
      const deferred = new Deferred<void>();

      this.unacknowledgedPublishes.set(id, deferred);

      result = deferred.promise;
    }

    await this.queue(packet);

    return result;
  }

  public async subscribe(
    topic: SubscriptionOption | string | (SubscriptionOption | string)[],
    qos?: QoS
  ): Promise<Subscription[]> {
    switch (this.connectionState) {
      case 'disconnecting':
      case 'disconnected':
        throw new Error(
          `should not be subscribing in ${this.connectionState} state`
        );
    }

    const arr = Array.isArray(topic) ? topic : [topic];
    const subs = arr.map<Subscription>((sub) => {
      return typeof sub === 'object'
        ? { topic: sub.topic, qos: sub.qos || qos || 0, state: 'pending' }
        : { topic: sub, qos: qos || 0, state: 'pending' };
    });
    const promises = [];

    for (const sub of subs) {
      // Replace any matching subscription so we don't resubscribe to it
      // multiple times on reconnect. This matches what the broker is supposed
      // to do when it receives a subscribe packet containing a topic filter
      // matching an existing subscription.
      this.subscriptions = this.subscriptions.filter(
        (old) => old.topic !== sub.topic
      );

      this.subscriptions.push(sub);

      const deferred = new Deferred<SubackPacket | null>();

      this.unresolvedSubscribes.set(sub.topic, deferred);

      promises.push(deferred.promise.then(() => sub));
    }

    await this.flushSubscriptions();

    return Promise.all(promises);
  }

  protected async flushSubscriptions() {
    const subs = this.subscriptions.filter((sub) => sub.state === 'pending');

    if (subs.length > 0 && this.connectionState === 'connected') {
      await this.sendSubscribe(subs);
    }
  }

  private async sendSubscribe(subscriptions: Subscription[]) {
    const subscribePacket: SubscribePacket = {
      type: 'subscribe',
      id: this.nextPacketId(),
      subscriptions,
    };

    this.unacknowledgedSubscribes.set(subscribePacket.id, {
      subscriptions,
    });

    await this.send(subscribePacket);

    for (const sub of subscriptions) {
      sub.state = 'unacknowledged';
    }
  }

  public async unsubscribe(
    topic: string | string[]
  ): Promise<(Subscription | undefined)[]> {
    switch (this.connectionState) {
      case 'disconnecting':
      case 'disconnected':
        throw new Error(
          `should not be unsubscribing in ${this.connectionState} state`
        );
    }

    const arr = Array.isArray(topic) ? topic : [topic];
    const promises = [];

    for (const topic of arr) {
      const sub = this.subscriptions.find((sub) => sub.topic === topic);
      const deferred = new Deferred<UnsubackPacket | null>();
      const promise = deferred.promise.then(() => sub);

      if (sub) {
        if (
          this.connectionState !== 'connected' &&
          this.options.clean !== false
        ) {
          sub.state = 'removed';
        } else {
          switch (sub.state) {
            case 'pending':
              sub.state = 'removed';
              break;
            case 'removed':
            case 'replaced':
              // Subscriptions with these states should have already been removed.
              break;
            case 'unacknowledged':
            case 'acknowledged':
              sub.state = 'unsubscribe-pending';
              break;
            case 'unsubscribe-pending':
            case 'unsubscribe-unacknowledged':
            case 'unsubscribe-acknowledged':
              // Why is this happening?
              break;
          }
        }

        this.unresolvedUnsubscribes.set(topic, deferred);

        promises.push(promise);
      }
    }

    await this.flushUnsubscriptions();

    return Promise.all(promises);
  }

  protected async flushUnsubscriptions() {
    const subs = [];

    for (const sub of this.subscriptions) {
      if (sub.state === 'removed') {
        const unresolvedSubscribe = this.unresolvedSubscribes.get(sub.topic);

        if (unresolvedSubscribe) {
          this.unresolvedSubscribes.delete(sub.topic);

          unresolvedSubscribe.resolve(null);
        }

        const unresolvedUnsubscribe = this.unresolvedUnsubscribes.get(
          sub.topic
        );

        if (unresolvedUnsubscribe) {
          this.unresolvedUnsubscribes.delete(sub.topic);

          unresolvedUnsubscribe.resolve(null);
        }
      }

      if (sub.state === 'unsubscribe-pending') {
        subs.push(sub);
      }
    }

    this.subscriptions = this.subscriptions.filter(
      (sub) => sub.state !== 'removed'
    );

    if (subs.length > 0 && this.connectionState === 'connected') {
      await this.sendUnsubscribe(subs);
    }
  }

  private async sendUnsubscribe(subscriptions: Subscription[]) {
    const unsubscribePacket: UnsubscribePacket = {
      type: 'unsubscribe',
      id: this.nextPacketId(),
      topics: subscriptions.map((sub) => sub.topic),
    };

    this.unacknowledgedUnsubscribes.set(unsubscribePacket.id, {
      subscriptions,
    });

    await this.send(unsubscribePacket);

    for (const sub of subscriptions) {
      sub.state = 'unsubscribe-unacknowledged';
    }
  }

  public async disconnect(): Promise<void> {
    switch (this.connectionState) {
      case 'connected':
        await this.doDisconnect();
        break;
      case 'connecting':
      case 'waiting-for-connack':
        this.disconnectRequested = true;
        break;
      case 'offline':
        this.changeState('disconnected');
        this.stopTimers();
        break;
      default:
        throw new Error(
          `should not be disconnecting in ${this.connectionState} state`
        );
    }
  }

  private async doDisconnect() {
    this.changeState('disconnecting');
    this.stopTimers();
    await this.send({ type: 'disconnect' });
    await this.close();
  }

  // Methods implemented by subclasses

  protected abstract getDefaultURL(): URL | string;

  protected abstract validateURL(url: URL): void;

  protected abstract async open(url: URL): Promise<void>;

  protected abstract async write(bytes: Uint8Array): Promise<void>;

  protected abstract async close(): Promise<void>;

  protected encode(packet: AnyPacket, utf8Encoder?: UTF8Encoder): Uint8Array {
    return encode(packet, utf8Encoder);
  }

  protected decode(
    bytes: Uint8Array,
    utf8Decoder?: UTF8Decoder
  ): AnyPacketWithLength | null {
    return decode(bytes, utf8Decoder);
  }

  // This gets called from connect and when reconnecting.
  protected async openConnection() {
    try {
      this.changeState('connecting');

      this.url = this.getURL();

      this.log(`opening connection to ${this.url}`);

      await this.open(this.url);

      await this.send({
        type: 'connect',
        clientId: this.clientId,
        username: this.options.username,
        password: this.options.password,
        clean: this.options.clean !== false,
        keepAlive: this.keepAlive,
      });

      this.changeState('waiting-for-connack');

      this.startConnectTimer();
    } catch (err) {
      this.changeState('offline');

      if (!this.startReconnectTimer()) {
        this.notifyConnectRejected(new Error('connection failed'));
      }
    }
  }

  // This gets called when the connection is fully established (after receiving the CONNACK packet).
  protected async connectionEstablished(connackPacket: ConnackPacket) {
    if (this.unacknowledgedConnect) {
      this.log('resolving initial connect');

      this.unacknowledgedConnect.resolve(connackPacket);
    }

    if (this.options.clean !== false || !connackPacket.sessionPresent) {
      for (const sub of this.subscriptions) {
        if (sub.state === 'unsubscribe-pending') {
          sub.state = 'removed';
        } else {
          sub.state = 'pending';
        }
      }
    }

    await this.flushSubscriptions();
    await this.flushUnsubscriptions();
    await this.flushQueuedPackets();

    // TODO: resend unacknowledged publish and pubcomp packets

    if (this.disconnectRequested) {
      this.doDisconnect();
    } else {
      this.startKeepAliveTimer();
    }
  }

  // This gets called by subclasses when the connection is unexpectedly closed.
  protected connectionClosed() {
    this.log('connectionClosed');

    switch (this.connectionState) {
      case 'disconnecting':
        this.changeState('disconnected');
        break;
      default:
        this.changeState('offline');
        this.reconnectAttempt = 0;
        this.startReconnectTimer();
        break;
    }

    this.stopKeepAliveTimer();
  }

  protected connectionError(error: any) {
    // TODO: decide what to do with this
    this.log('connectionError', error);
  }

  protected bytesReceived(bytes: Uint8Array) {
    this.log('bytes received', bytes);

    this.emit('bytesreceived', bytes);

    let buffer: Uint8Array | null = bytes;

    const oldBuffer = this.buffer;

    if (oldBuffer) {
      const newBuffer = new Uint8Array(oldBuffer.length + bytes.length);

      newBuffer.set(oldBuffer);
      newBuffer.set(bytes, oldBuffer.length);

      buffer = newBuffer;
    } else {
      buffer = bytes;
    }

    do {
      const packet = this.decode(buffer);

      if (!packet) {
        break;
      }

      this.log(`received ${packet.type} packet`, packet);

      this.packetReceived(packet);

      if (packet.length < buffer.length) {
        buffer = buffer.slice(packet.length);
      } else {
        buffer = null;
      }
    } while (buffer);

    this.buffer = buffer;
  }

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
      case 'waiting-for-connack':
        break;
      default:
        throw new Error(
          `should not be receiving connack packets in ${this.connectionState} state`
        );
    }

    this.changeState('connected');

    this.everConnected = true;

    this.stopConnectTimer();

    this.connectionEstablished(packet);
  }

  protected handlePublish(packet: PublishPacket) {
    this.emit('message', packet.topic, packet.payload, packet);

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
    const deferred = this.unacknowledgedPublishes.get(packet.id);

    if (deferred) {
      this.unacknowledgedPublishes.delete(packet.id);
      deferred.resolve();
    } else {
      this.log(`received puback packet with unrecognized id ${packet.id}`);
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

  protected handleSuback(packet: SubackPacket) {
    const unacknowledgedSubscribe = this.unacknowledgedSubscribes.get(
      packet.id
    );

    // TODO: verify returnCodes length matches subscriptions.length

    if (unacknowledgedSubscribe) {
      this.unacknowledgedSubscribes.delete(packet.id);

      let i = 0;

      for (const sub of unacknowledgedSubscribe.subscriptions) {
        sub.state = 'acknowledged';
        sub.returnCode = packet.returnCodes[i++];

        const deferred = this.unresolvedSubscribes.get(sub.topic);

        if (deferred) {
          this.unresolvedSubscribes.delete(sub.topic);

          deferred.resolve(packet);
        }
      }
    } else {
      throw new Error(
        `received suback packet with unrecognized id ${packet.id}`
      );
    }
  }

  protected handleUnsuback(packet: UnsubackPacket) {
    const unacknowledgedUnsubscribe = this.unacknowledgedUnsubscribes.get(
      packet.id
    );

    if (unacknowledgedUnsubscribe) {
      this.unacknowledgedUnsubscribes.delete(packet.id);

      for (const sub of unacknowledgedUnsubscribe.subscriptions) {
        if (!sub) {
          continue;
        }

        sub.state = 'unsubscribe-acknowledged';

        this.subscriptions = this.subscriptions.filter((s) => s !== sub);

        const deferred = this.unresolvedUnsubscribes.get(sub.topic);

        if (deferred) {
          this.unresolvedUnsubscribes.delete(sub.topic);

          deferred.resolve(packet);
        }
      }
    } else {
      throw new Error(
        `received unsuback packet with unrecognized id ${packet.id}`
      );
    }
  }

  protected startConnectTimer() {
    this.startTimer(
      'connect',
      () => {
        this.connectTimedOut();
      },
      this.options.connectTimeout || defaultConnectTimeout
    );
  }

  protected connectTimedOut() {
    switch (this.connectionState) {
      case 'waiting-for-connack':
        break;
      default:
        throw new Error(
          `connect timer should time out in ${this.connectionState} state`
        );
    }

    this.changeState('offline');

    this.close();

    this.notifyConnectRejected(new Error('connect timed out'));

    this.reconnectAttempt = 0;

    this.startReconnectTimer();
  }

  protected notifyConnectRejected(err: Error) {
    if (this.unacknowledgedConnect) {
      this.log('rejecting initial connect');

      this.unacknowledgedConnect.reject(err);
    }
  }

  protected stopConnectTimer() {
    if (this.timerExists('connect')) {
      this.stopTimer('connect');
    }
  }

  protected startReconnectTimer() {
    const options = this.options;

    let reconnectOptions;
    let defaultOptions;

    if (!this.everConnected) {
      reconnectOptions = options.connect || {};
      defaultOptions = defaultConnectOptions;
    } else {
      reconnectOptions = options.reconnect || {};
      defaultOptions = defaultReconnectOptions;
    }

    if (reconnectOptions === false) {
      return;
    } else if (reconnectOptions === true) {
      reconnectOptions = {};
    }

    const attempt = this.reconnectAttempt;
    const maxAttempts = reconnectOptions.retries ?? defaultOptions.retries;

    if (attempt >= maxAttempts) {
      return false;
    }

    // I started off using the formula in this article
    // https://dthain.blogspot.com/2009/02/exponential-backoff-in-distributed.html
    // but modified the random part so that the delay will be strictly
    // increasing.
    const min = reconnectOptions.minDelay ?? defaultOptions.minDelay;
    const max = reconnectOptions.maxDelay ?? defaultOptions.maxDelay;
    const factor = reconnectOptions.factor ?? defaultOptions.factor;
    const random = reconnectOptions.random ?? defaultOptions.random;

    // The old way:
    // const randomness = 1 + (random ? Math.random() : 0);
    // const delay = Math.floor(Math.min(randomness * min * Math.pow(factor, attempt), max));

    // The new way:
    const thisDelay = min * Math.pow(factor, attempt);
    const nextDelay = min * Math.pow(factor, attempt + 1);
    const diff = nextDelay - thisDelay;
    const randomness = random ? diff * Math.random() : 0;
    const delay = Math.floor(Math.min(thisDelay + randomness, max));

    this.log(`reconnect attempt ${attempt + 1} in ${delay}ms`);

    this.startTimer(
      'reconnect',
      () => {
        this.reconnectAttempt++;
        this.openConnection();
      },
      delay
    );

    return true;
  }

  protected stopReconnectTimer() {
    if (this.timerExists('reconnect')) {
      this.stopTimer('reconnect');
    }
  }

  protected startKeepAliveTimer() {
    if (!this.keepAlive) {
      return;
    }

    // This method doesn't get called until after sending the connect packet
    // so this.lastPacketTime should have a value.
    const elapsed = Date.now() - this.lastPacketTime!.getTime();
    const timeout = this.keepAlive * 1000 - elapsed;

    this.startTimer('keepAlive', () => this.sendKeepAlive(), timeout);
  }

  protected stopKeepAliveTimer() {
    if (this.timerExists('keepAlive')) {
      this.stopTimer('keepAlive');
    }
  }

  protected async sendKeepAlive() {
    if (this.connectionState === 'connected') {
      const elapsed = Date.now() - this.lastPacketTime!.getTime();
      const timeout = this.keepAlive * 1000;

      if (elapsed >= timeout) {
        await this.send({
          type: 'pingreq',
        });
      }

      this.startKeepAliveTimer();
    } else {
      this.log('keepAliveTimer should have been cancelled');
    }
  }

  protected stopTimers() {
    this.stopConnectTimer();
    this.stopReconnectTimer();
    this.stopKeepAliveTimer();
  }

  protected startTimer(
    name: string,
    cb: (...args: unknown[]) => void,
    delay: number
  ) {
    if (this.timerExists(name)) {
      this.log(`timer ${name} already exists`);

      this.stopTimer(name);
    }

    this.log(`starting timer ${name} for ${delay}ms`);

    this.timers[name] = setTimeout(() => {
      delete this.timers[name];

      this.log(`invoking timer ${name} callback`);

      cb();
    }, delay);
  }

  protected stopTimer(name: string) {
    if (!this.timerExists(name)) {
      this.log(`no timer ${name} to stop`);

      return;
    }

    this.log(`stopping timer ${name}`);

    const id = this.timers[name];

    if (id) {
      clearTimeout(id);

      delete this.timers[name];
    }
  }

  protected timerExists(name: string) {
    return !!this.timers[name];
  }

  // Utility methods

  protected changeState(newState: ConnectionStates) {
    const oldState = this.connectionState;

    this.connectionState = newState;

    this.log(`connectionState: ${oldState} -> ${newState}`);

    this.emit('statechange', { from: oldState, to: newState });

    this.emit(newState);
  }

  protected generateClientId() {
    let clientId;

    if (typeof this.options.clientId === 'string') {
      clientId = this.options.clientId;
    } else if (typeof this.options.clientId === 'function') {
      clientId = this.options.clientId();
    } else {
      const prefix = this.options.clientIdPrefix || defaultClientIdPrefix;
      const suffix = Math.random().toString(36).slice(2);

      clientId = `${prefix}-${suffix}`;
    }

    return clientId;
  }

  private getURL(): URL {
    let url: URL | string | void =
      typeof this.options.url === 'function'
        ? this.options.url()
        : this.options.url;

    if (!url) {
      url = this.getDefaultURL();
    }

    if (typeof url === 'string') {
      url = this.parseURL(url);
    }

    const protocol = url.protocol.slice(0, -1);

    if (!url.port) {
      url.port = defaultPorts[protocol].toString();
    }

    this.validateURL(url);

    return url;
  }

  protected parseURL(url: string) {
    let parsed = new URL(url);

    // When Deno and browsers parse "mqtt:" URLs, they return "//host:port/path"
    // in the `pathname` property and leave `host`, `hostname`, and `port`
    // blank. This works around that by re-parsing as an "http:" URL and then
    // changing the protocol back to "mqtt:". Node.js doesn't behave like this.
    if (!parsed.hostname && parsed.pathname.startsWith('//')) {
      const protocol = parsed.protocol;
      parsed = new URL(url.replace(protocol, 'http:'));
      parsed.protocol = protocol;
    }

    return parsed;
  }

  protected nextPacketId() {
    this.lastPacketId = (this.lastPacketId + 1) % packetIdLimit;

    // Don't allow packet id to be 0.
    if (!this.lastPacketId) {
      this.lastPacketId = 1;
    }

    return this.lastPacketId;
  }

  protected async queue(packet: AnyPacket) {
    if (this.connectionState !== 'connected') {
      this.log(`queueing ${packet.type} packet`);

      this.queuedPackets.push(packet);
    } else {
      return this.send(packet);
    }
  }

  protected async flushQueuedPackets() {
    for (const packet of this.queuedPackets) {
      await this.send(packet);
    }

    this.queuedPackets = [];
  }

  protected async send(packet: AnyPacket) {
    this.log(`sending ${packet.type} packet`, packet);

    this.emit('packetsend', packet);

    const bytes = this.encode(packet);

    this.emit('bytessent', bytes);

    await this.write(bytes);

    this.lastPacketTime = new Date();
  }

  public on(eventName: string, listener: Function) {
    let listeners = this.eventListeners.get(eventName);

    if (!listeners) {
      listeners = [];
      this.eventListeners.set(eventName, listeners);
    }

    listeners.push(listener);
  }

  public off(eventName: string, listener: Function) {
    const listeners = this.eventListeners.get(eventName);

    if (listeners) {
      this.eventListeners.set(
        eventName,
        listeners.filter((l) => l !== listener)
      );
    }
  }

  protected emit(eventName: string, ...args: unknown[]) {
    const listeners = this.eventListeners.get(eventName);

    if (listeners) {
      for (const listener of listeners) {
        listener(...args);
      }
    }
  }
}

class Deferred<T> {
  promise: Promise<T>;
  resolve!: (val: T) => void;
  reject!: (err: Error) => void;

  constructor() {
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}
