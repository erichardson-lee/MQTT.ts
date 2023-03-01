#!/usr/bin/env -S deno run --allow-net

import { Client } from "../mod.ts";

async function main() {
  const client = new Client({
    url: "mqtt://localhost",
  });

  await client.connect();

  await client.publish("topic", "payload");

  await client.disconnect();
}

main();
