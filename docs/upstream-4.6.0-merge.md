# Upstream merge: oceanprotocol/ocean-node v4.6.0 → enterprise patch set

This repository tracks two upstreams:

| upstream | what it gives us | how it enters this repo |
|---|---|---|
| [`oceanprotocol/ocean-node`](https://github.com/oceanprotocol/ocean-node) | the open-source node: features, fixes, security patches | cherry-picked as **verbatim** commits, one per upstream commit, with `(cherry picked from commit …)` in the message |
| [`OceanProtocolEnterprise/ocean-node`](https://github.com/OceanProtocolEnterprise/ocean-node) | the enterprise patch set (fee tokens, `did:ope`, confidential EVM, remote/encrypted DDO, admin allow-list, dataspace/SSI deployment) | this repo's `main`, unchanged; `main` *is* enterprise `main` |

Nothing of the enterprise patch set is rewritten here. Upstream commits arrive as their own
commits; every line of code that is **not** a verbatim upstream change lives in exactly one
follow-up commit, `reconcile: …`, which this document describes.

- Base: enterprise `main` @ `35b864f6` (**v4.2.2**)
- Upstream target: `oceanprotocol/ocean-node` tag **v4.6.0** @ `1fdce009a47e6573d8163c4c7bea09426c7d9883`
- Branch: `sync/upstream-4.6.0`
- Machine-readable manifest: [`docs/upstream-4.6.0-merge.json`](upstream-4.6.0-merge.json)

## The two-phase branch layout

```
35b864f6  chore: v4.2.2                       <- enterprise main, untouched
4520cf28  security updates (#1495)            \
d00843e9  bind C2D algorithm container…(#1527) \  phase 1: upstream commits, verbatim
fb65753c  fix logging leak (#1528)             | (conflicts resolved to the *upstream* side,
b483521d  orphane jobs (#1472)                 |  never to enterprise behaviour)
eaf1b197  Fix: paid/free compute accepts…(#1531)|
6fa6b667  Isolate C2D inputs per index…(#1534) /
<this>    reconcile: …                      <- phase 2: the only new code
```

Rules that keep the history honest:

1. **Phase 1 is mechanical.** Each commit is what git produces from `git cherry-pick -x <sha>`.
   Where upstream collided with the enterprise patch set, the conflict was resolved to the
   *upstream* side (or, when the upstream side of a hunk also carried code from a later wave,
   only the commit's own edits were taken). No enterprise rule is encoded in phase 1.
2. **Phase 2 carries every deviation.** Restoring enterprise semantics, keeping our CI
   pipelines, adapting the ported tests, and this documentation. That commit is the contract:
   if a future sync needs to know what we changed about upstream's code, it reads one commit.
3. Phase 1 is self-contained and compiles on its own (`npm run build` OK, `test:unit`
   404 passing / 2 pre-existing failures) — but it is **not** behaviourally safe on its own:
   it loses the enterprise per-event order validation and replaces our CI pipelines with
   upstream's. Phase 2 is what makes the branch shippable.

## Wave 1: what was imported

Six commits, all of them security fixes (see `docs/upstream-sync-plan.md` §4 for the whole
4.2.0 → 4.6.0 plan, waves 2-4 are still pending).

| upstream | PR | what it fixes | phase-1 apply | what phase 2 does |
|---|---|---|---|---|
| `72722717` | #1495 | CI/dependabot hardening | conflict → upstream's `ci.yml`/`docker.yml` taken as-is; `dependabot.yml` added | restore our release workflows and keep only the hardening (`permissions: contents: read`, `persist-credentials: false`, action majors) |
| `371086b4` | #1527 | C2D algorithm container bound to its DDO (allow-list bypass) | clean | nothing (enterprise markers verified present) |
| `4d228fea` | #1528 | request payloads (headers, signatures) logged before validation | conflict → `validateCommands.ts` + test from upstream, `OceanNode.ts` import union, `compute.ts` only the commit's own edits | nothing beyond that (`#1528` restores deep credential redaction, which our tree had diluted to top-level fields) |
| `f288a129` | #1472 | orphaned jobs cannot decode env | clean | nothing |
| `bacaba91` | #1531 | compute accepts an order paid by a third party | conflict → `validateOrders.ts` from upstream | re-apply the enterprise per-event datatoken validation and keep upstream's payer binding |
| `0b86a8a6` | #1534 | C2D inputs isolated per index; restores `DIDS`/`TRANSFORMATION_DID` | clean | nothing |

## What the reconciliation commit contains, and why

`src/components/core/utils/validateOrders.ts` — upstream resolves the datatoken from
`txReceiptMined.to` and calls `getERC721Address()` once per transaction. The enterprise patch
validates **per `OrderStarted` event** (`event.log.address` + a per-event `getERC721Address()`
inside a `try/catch`, so an unreadable datatoken is skipped instead of failing the whole
receipt). Reconciled version: per-event resolution kept, upstream's env-AND payer binding added
— when a `payerAddress` is supplied the event must satisfy `args[0] === userAddress` **and**
`args[1] === payerAddress`; `!== undefined` is used so an empty payer takes the strict branch
(fail closed). Call sites are upstream's: `startCompute.ts` (paid via the shared `validateAssets`
`authorizeAsset` hook, free via its own `authorizeAsset`) and `initialize.ts`, all passing
`task.consumerAddress` as the payer.

`src/test/unit/computeOrderPayerValidation.test.ts` — the ported test mocked receipt logs as
`{ topics, data }`. Because our validator reads the emitting address per event, the mock now also
sets `address` (a real receipt log always carries it). No assertion was weakened.

`.github/workflows/ci.yml`, `.github/workflows/docker.yml` — upstream's versions publish to
upstream registries; ours build/scan/publish our images. Our pipelines are kept and only the
hardening from #1495 is adopted: top-level `permissions: contents: read`,
`persist-credentials: false` on every checkout, and the action majors upstream moved to
(`checkout`/`setup-node` v7, `cache` v6, `upload-artifact` v7, `download-artifact` v8,
`setup-buildx` v4, `login` v4, `build-push` v7).

`docs/upstream-sync-plan.md` — the wave plan, the enterprise "compatibility contract" file list,
the per-commit port status of the whole 4.2.0 → 4.6.0 window, and the wave-1 execution log.
This document and its JSON manifest exist so the mapping survives without reading the plan.

## Gates run on the tip of `sync/upstream-4.6.0`

| gate | result |
|---|---|
| `npm run build` | pass |
| `npm run lint` (includes `tsc --noEmit`) | 0 errors, 67 warnings — identical to the pre-sync baseline |
| `npm run test:unit` | 404 passing, 2 failing (baseline: 374 passing, same 2) |
| `npm run test:computeunit` | 141 passing |
| `npm run test:computeintegration` | not run — needs Barge (`ADDRESS_FILE`, `~/.ocean/ocean-contracts/artifacts/address.json`) |
| C2D smoke (1 paid + 1 free) | not run — same missing stack |

The two `test:unit` failures are environmental and pre-exist the sync: `networking.test`
before-all (`OceanP2P.start`, no libp2p listener available here) and `logging.test` after-all
(`Invalid PRIVATE_KEY`). `.mocharc.json` sets `bail: true`, so the run stops at the first of them;
that is why the passing count is compared to the baseline, not read as a total.

Caveat: measured on Node **26.7.0** (the only interpreter on this host) while `.nvmrc` pins
24.19.0. Re-run the baseline on 24 in CI before merging.

## How to refresh later

```bash
# enterprise changes
git remote add enterprise https://github.com/OceanProtocolEnterprise/ocean-node
git fetch enterprise main && git merge enterprise/main

# upstream changes
git remote add upstream https://github.com/oceanprotocol/ocean-node
git fetch upstream --tags
# already applied here?
git rev-list --cherry-mark --left-right --no-merges HEAD...upstream/main | cut -c1 | sort | uniq -c
# port the next wave: cherry-pick -x each commit, resolve conflicts to the upstream side,
# then land ONE reconciliation commit that documents the delta in this file's tables.
```

Do not `git merge upstream/main`: at this base it produces 505 conflicted files. The cherry-pick
per wave is the supported path (`docs/upstream-sync-plan.md` §8).

## Not ported here

Waves 2-4 of the 4.2.0 → 4.6.0 window (service-on-demand status/outputs/expiry, streamable logs
+ HF mirroring + Comfy + Node 24.22.1, resource limits/VRAM/`PASS_CONTAINER_ENVS`) and everything
marked *do not port / needs a product decision* in `docs/upstream-sync-plan.md` §6 (ZIP outputs,
`memoryTotal` required, Node 26).