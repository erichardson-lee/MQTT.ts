# MQTT.ts

> This repo is a fork of [JDiamond/MQTT.ts](https://github.com/jdiamond/MQTT.ts)
> as it is no longer maintained.

This is an implementation of the MQTT 3.1.1 protocol written in TypeScript.

## Quick Start

```ts
import { Client } from "https://deno.land/x/mqtt/deno/mod.ts";

const client = new Client({ url: "mqtt://test.mosquitto.org" });

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

See [CONTRIBUTING.md](CONTRIBUTING.md)
