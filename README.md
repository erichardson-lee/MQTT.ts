# MQTT.ts

> This repo is a fork of [JDiamond/MQTT.ts](https://github.com/jdiamond/MQTT.ts)
> as it is no longer maintained.

This is an implementation of the MQTT 3.1.1 protocol written in TypeScript.

## Quick Start

```ts
import { Client } from "https://deno.land/x/mqtt/deno/mod.ts";

const client = new Client({ url: "mqtt://test.mosquitto.org" }); /

await client.connect();

await client.subscribe("incoming/#");

client.on("message", (topic, payload) => {
  console.log(topic, payload);
});

await client.publish("my/topic", "my payload");

await client.disconnect();
```

## Examples

Look in [examples/](examples/) to see examples of using the client.

There are some CLI tools in [tools](tools) that are similar to mosquitto_pub and
mosquitto_sub.

To subscribe:

```bash
deno run --allow-net tools/sub.ts -u mqtt://test.mosquitto.org -t "MQTT.ts/test/topic" -v
```

To publish:

```bash
deno run --allow-net tools/pub.ts -u mqtt://test.mosquitto.org -t "MQTT.ts/test/topic" -m "hello"
```

## Development

First started working with Deno 1.0.0, but I only test with recent versions
(most recently 1.24.1). Maybe I should set up some GitHub actions?

To lint, check types, and run tests:

```bash
deno lint
deno task tsc
deno test

# Or, run all with:
deno task check
```

To run a local broker on macOS:

```bash
brew install mosquitto
/usr/local/sbin/mosquitto -c mosquitto-mac.conf
```

To run a local broker on Ubuntu in WSL2:

```bash
sudo apt-add-repository ppa:mosquitto-dev/mosquitto-ppa
sudo apt update
sudo apt install mosquitto
mosquitto -c mosquitto-wsl2-ubuntu.conf
```

To test publishing and subscribing to your local broker, run these commands in
separate shells:

```bash
deno run --allow-net tools/sub.ts -t "foo/#" -v
deno run --allow-net tools/pub.ts -t "foo/bar" -m "baz"
```

To make a release:

```bash
deno task check

cd browser
# update version in package.json
npm install
npm run build
npm publish
cd ..

cd node
# update version in package.json
npm install
npm run build
npm publish
cd ..

git tag x.y.z
git push --tags
```

## Protocol Links

- [5.0](https://docs.oasis-open.org/mqtt/mqtt/v5.0/mqtt-v5.0.html)
- [3.1.1](https://docs.oasis-open.org/mqtt/mqtt/v3.1.1/mqtt-v3.1.1.html)
- [3.1](https://public.dhe.ibm.com/software/dw/webservices/ws-mqtt/mqtt-v3r1.html)

## Roadmap to 1.0

- finish API docs
- protocol version 3.1
- mqtts for deno and node clients
- use native event target/emitter classes
- events for messages matching topic filters
- async iterators for messages matching topic filters
- make disconnect wait until all publishes sent/acknowledged
- address all TODO comments in code
- release process
  - tag for deno.land/x to use
  - publish Node.js and browser builds to npm
    - keep in sync or allow versions to drift?

## Post 1.0

- protocol version 5.0
- round robin connect to multiple brokers
- benchmarking and performance improvements
- MQTT over QUIC
- base class for server applications?
