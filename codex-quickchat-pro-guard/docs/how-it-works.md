# How the guard works

## Scope and threat model

The guard covers the Quick Chat request path in the exact supported Codex desktop build. Its threat model is a mismatch between the model selected/requested in the client and the routing model declared by the server.

A client-side model selector is not proof of server execution. For that reason, merely replacing the outgoing model string is insufficient. The response must remain hidden until server-originated routing metadata has been evaluated.

The guard does not attempt to prove undisclosed backend implementation details. It can only enforce the contract visible to the client: the server-declared routing model must be exactly `gpt-5-6-pro`.

## State machine

Each Quick Chat request starts with:

- `verified = false`
- an empty pending-message buffer
- an empty delivered-message ledger

The event flow is:

```text
send request
  └─ overwrite requested model with gpt-5-6-pro

message event
  ├─ verified: deliver and record
  └─ unverified: buffer only

server_ste_metadata event
  ├─ no routing fields: keep waiting
  ├─ every present field == gpt-5-6-pro: mark verified, flush buffer
  └─ Mini/conflict/other: clear buffer, hide delivered messages,
                           cancel stream, raise model-route-mismatch

complete event
  ├─ verified: complete normally
  └─ unverified: clear buffer, raise model-route-unverified
```

## Accepted evidence

The supported build copies `server_ste_metadata.metadata` into its request state. The guard evaluates:

1. `resolved_model_slug`, when present
2. `model_slug`, when present

Every non-empty value present must equal `gpt-5-6-pro`. A pair such as `model_slug = gpt-5-6-pro` and `resolved_model_slug = gpt-5-5-mini` fails. A display label or assistant-message metadata is not accepted as routing proof.

## Why sparse byte operations

Publishing a modified Electron archive would redistribute third-party application code and make review difficult. This repository instead publishes:

- the exact source archive and asset hashes;
- byte offsets and deletion lengths;
- SHA-256 hashes of bytes expected at those locations;
- a small base64 replacement payload needed to reproduce the guard;
- exact expected hashes for the patched asset and rebuilt archive.

Operations are applied from the highest source offset to the lowest, so earlier offsets stay stable. The patcher checks the full source hash, every deletion hash, required sentinels, and the final output hash.

## Installation isolation

The Microsoft Store package is read but never modified. The installer creates a user-space copy and a separate Electron user-data directory. The launcher verifies the rebuilt `app.asar` hash before every start and refuses to start while another Codex/ChatGPT desktop process is running outside the guarded copy.

The separate profile prevents the ordinary package singleton and local browser state from being mistaken for the guarded instance. It also means the user may need to sign in again.

## Limitations

- Only the exact package version and archive hash in the manifest are supported.
- Only the Quick Chat path represented by the patched asset is guarded.
- A future event schema or routing-field semantic change requires a new review.
- The guard cannot grant model access or override capacity, policy, safety, or account routing decisions.
- If the server omits routing evidence, a legitimate Pro response is blocked by design.
- No client can detect a server that deliberately reports false metadata.
