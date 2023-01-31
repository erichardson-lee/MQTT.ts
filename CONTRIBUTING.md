# Contributing

## Tooling

To develop, you need both [Deno](https://deno.land/) v1.24.0+ and
[Docker](https://www.docker.com/) installed.

## Testing

To lint, check types, and run tests:

```bash
deno lint
deno check mod.ts
deno test
```

## Mosquitto

To Run Mosquitto (MQTT broker) locally:

```bash
docker-compose up -d
```

To test publishing and subscribing, run these commands in separate shells:

`deno run --allow-net tools/sub.ts -t "foo/#" -v`

`deno run --allow-net tools/pub.ts -t "foo/bar" -m "baz"`

## Releasing

Before releasing, ensure testing has been completed.

```bash
git tag x.y.z
git push --tags
```

## Protocol Links

- [5.0](https://docs.oasis-open.org/mqtt/mqtt/v5.0/mqtt-v5.0.html)
- [3.1.1](https://docs.oasis-open.org/mqtt/mqtt/v3.1.1/mqtt-v3.1.1.html)
- [3.1](https://public.dhe.ibm.com/software/dw/webservices/ws-mqtt/mqtt-v3r1.html)
