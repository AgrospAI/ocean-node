# Upstream sync plan — `oceanprotocol/ocean-node` → `OceanProtocolEnterprise/ocean-node`

Prepared: 2026-11-01
Basis: `main` of both repos, fetched locally (`upstream` remote added to the enterprise clone; upstream tags under `refs/upstream-tags/*`).

| | enterprise | upstream |
|---|---|---|
| HEAD | `35b864f6` — *chore: v4.2.2* (2026-10-08) | `c71eb981` — *Merge PR #1545* (2026-10-30), tag `v4.6.0` (2026-10-29) |
| Files | 426 | 452 |
| Fork point | `5c0f8caf` (2025-07-11) | same |
| Engine / `.nvmrc` | `node >=24`, `24.19.0` | `node >=24`, `26.12.1` |

---

## 1. TL;DR

1. **Enterprise `main` is upstream `v4.2.0` + a small, deliberate patch set.** `git diff v4.2.0 HEAD` is only **88 files, +3 040 / −1 423**, and 341 of 416 common files are byte-identical to `v4.2.0`. The enterprise specific work (fee-token validation, `did:ope`, confidential EVM, remote/encrypted DDO, admin access-list) lives on top of the upstream base — not as a separate architecture.
2. **The debt to close is `v4.2.0 → v4.6.0` (2026-09-07 → 2026-10-29): 4 releases, 73 commits, 148 files, +12 094 / −2 555.** Everything older is either already cherry-picked (40 patches are already patch-equivalent in `main`) or superseded by upstream's 4.0.0 refactor and by our own implementations.
3. **A plain `git merge upstream/main` is not viable: it produces 505 conflicted files** (`git merge-tree --write-tree HEAD upstream/main`). The sync must be done as curated cherry-pick waves on `feat/sync-<date>`, which is exactly the convention already used in this repo (`feat/sync-8-9-26`, `feat/sync-6-10`, `feat/sync-july`).
4. **Four upstream fixes are security-grade and should ship first, independently of the rest:**
   - `#1527` trusted-algorithm allow-list bypass in C2D (*binds algorithm container to its DDO*) — cherry-picks cleanly.
   - `#1531` paid/free compute accepts a datatoken order paid by someone else — conflicts only in `startCompute.ts` / `validateOrders.ts`, i.e. exactly where we already rewrote the logic; needs a real reconciliation, not a merge.
   - `#1528` credentials (file-object headers, signatures) written to logs before validation (CWE-532).
   - `#1534` C2D inputs collide/overwrite in `/data/inputs` (publisher-controlled file name) — cherry-picks cleanly.
5. Everything else in the window is additive at the API level: **one new HTTP route** (`GET /api/services/serviceResult`) and four new env vars. The only client-visible break is the compute-output format **TAR → ZIP**.

---

## 2. Measured state (reproducible)

```bash
# content distance
git diff --shortstat refs/upstream-tags/v4.2.0 HEAD          # 88 files, 3040 insertions, 1423 deletions
git diff --shortstat refs/upstream-tags/v4.2.0 refs/upstream-tags/v4.6.0   # 148 files, 12094 / 2555
git merge-tree --write-tree --name-only HEAD upstream/main | tail -n +2 | wc -l   # 505 conflicted files

# patch-level accounting
git rev-list --cherry-mark --left-right --no-merges HEAD...upstream/main | cut -c1 | sort | uniq -c
#  538 <   (enterprise-only)
#   40 =   (already in main, different SHA — cherry-picked)
#  453 >   (upstream-only, not patch-equivalent)
```

State of the 453 upstream-only patches, checked by content (file blobs at HEAD vs at that commit):

| verdict | commits | meaning |
|---|---|---|
| already applied | 28 | content of every touched file is identical to upstream |
| mixed | 106 | partly applied, file since diverged |
| open | 319 | file still differs |
| **total `open`+`mixed`** | **425** | of which **343 predate the 4.0.0 refactor (2026-08-28) and 82 are post-refactor** |

Per-release movement upstream:

| step | files | churn |
|---|---|---|
| 4.2.0 → 4.3.0 | 58 | +5 707 / −1 277 (Service-on-Demand status, model-download readiness, service outputs archive/zip, expiry in background, bucket-sharing) |
| 4.3.0 → 4.4.0 | 28 | +2 236 / −945 (CI/dependabot hardening, streamable logs, C2D algorithm↔DDO binding, log-leak fix, orphan jobs) |
| 4.4.0 → 4.5.0 | 38 | +3 175 / −115 (HF mirror + client patch, order-reuse fix, C2D input isolation, Comfy readiness, Node 24.22.1) |
| 4.5.0 → 4.6.0 | 22 | +976 / −218 (disk limits, container env passthrough, VRAM enforcement, Node 26.12.1) |

---

## 3. Enterprise patch set = the compatibility contract

`git diff refs/upstream-tags/v4.2.0 HEAD` — these are the files a sync can break. Anything upstream does inside them must be re-validated against our behaviour, not just compiled.

| file (enterprise churn) | what it carries |
|---|---|
| `src/utils/feeTokenValidation.ts` (new, +201) + `src/components/core/handler/feesHandler.ts` (+156/−5) | `EnterpriseFeeCollector` fee-token validation per chain/env; `UnsupportedFeeToken` reporting |
| `src/components/core/handler/ddoHandler.ts` (+42/−39), `src/components/core/utils/validateDdoHandler.ts` | accepts `did:ope:` (DID v5) next to `did:op:`; remote DDO; ID recomputation instead of checksum compare |
| `src/components/core/compute/startCompute.ts` (+83/−5), `src/utils/crypt.ts` (+57) | confidential EVM (`isConfidentialChainDDO`, template-4 on-chain decrypt), algorithm checksums |
| `src/components/core/utils/validateOrders.ts` (+23/−11) | per-event datatoken validation, tolerant of unreadable datatokens — **same function upstream rewrote in `#1531`** |
| `src/components/Indexer/processors/MetadataEventProcessor.ts` (+89/−5), `BaseProcessor.ts` (+78/−5) | remote/encrypted IPFS metadata payloads, hash checks, hardcoded-event fix |
| `src/components/core/admin/adminHandler.ts` (+44/−9) | `allowedAdminsList` on-chain access list |
| `src/components/httpRoutes/validateCommands.ts` (−53), `src/test/unit/validateCommands.test.ts` (−98) | signature/smart-account validation for commands (tests removed on purpose) |
| `src/utils/config/{schemas,builder,constants}.ts` (+4/+0/+1) | enterprise env additions |
| `.env.node.example`, `docker-compose.yml` (+58), `src/test/integration/s3Storage.test.ts` (+210) | dataspace/SSI stack integration, S3 persistent storage |
| `.github/workflows/docker.yml` (+115/−236), `codeql.yml` (new) | our image build/scan pipeline |

Consequence: the *code* conflicts concentrate in C2D (`compute_engine_docker.ts` — 14 of the tested commits conflict there) and in the service-on-demand types (`ServiceOnDemand.ts`, 5 commits). `docs/services.md` is our most-diverged doc (+542/−276) and conflicts in 11 commits — trivial but noisy.

---

## 4. Wave plan

Method: each upstream commit was cherry-picked with `git cherry-pick -n` into a detached worktree at enterprise `HEAD` and rolled back. 47 non-dependency commits in `v4.2.0..v4.6.0` were tested: **14 clean, 29 conflict, 4 already applied**. Status below is that measured result.

### Wave 0 — safety net (before any port)

- Branch `feat/sync-2026-11` off `main`.
- Baseline: `npm run build && npm run lint && npm run test:unit` on untouched `main`; record the pre-existing failures so they are not blamed on the sync.
- Add a regression test for each ported security fix *first* (order-reuse, trusted-algorithm allow-list, log leakage).

### Wave 1 — security fixes (ship alone, hotfix-able)

| PR / commit | what it fixes | port status |
|---|---|---|
| `#1527` `371086b4` | dataset owner's `publisherTrustedAlgorithms` allow-list bypass (algorithm container not bound to DDO) | **clean** |
| `#1534` `0b86a8a6` | C2D inputs isolated per index; restores `DIDS`/`TRANSFORMATION_DID` | **clean** |
| `#1531` `bacaba91` | compute accepts an on-chain order paid by a third party | conflict in `startCompute.ts`, `validateOrders.ts` — reconcile with our rewrite, keep our per-event validation, adopt upstream's `transferTxId → order` ownership check |
| `#1528` `4d228fea` | request payloads (headers, signatures) logged before validation | conflict in `OceanNode.ts`, `httpRoutes/compute.ts`, `validateCommands.ts`, its unit test |
| `#1472` `f288a129` | orphaned jobs cannot decode env | **clean** |
| `#1495` `72722717` | CI/dependabot hardening (`.github` only) | conflict in `ci.yml`, `docker.yml` — take the dependabot config, keep our workflows |

Gate: `npm run test:computeunit`, `npm run test:computeintegration`, plus one paid and one free C2D run against the point-5 stack.

### Wave 2 — 4.3.0: Service-on-Demand status, outputs, expiry (largest conflicts)

| commit | change | port status |
|---|---|---|
| `8c470a35` … `f794919e` (8 commits) | service status PoC, container-diff based model-download readiness, hybrid discovery | first commit clean, remaining 7 conflict in `compute_engine_docker.ts`, `modelDownload.ts`, `serviceEngines.ts`, `serviceReadiness.ts` (+ their tests) — **port as one squash, not commit by commit** |
| `d7fea939`, `52cc53d2`, `21e89a12`, `e10080ba` | `PERSISTENT_STORAGE_ALLOW_BUCKET_SHARING`, results archived as zip, files preserved across restarts | conflicts: `docs/services.md` (only), `httpRoutes/compute.ts`, `ServiceOnDemand.ts`, `compute_engine_docker.ts` |
| `88bd7300`, `f0404537`, `95083a2f`, `07a059ce` | output archive hardening, expiry in background, bucket access recheck on extend | `95083a2f` clean, `07a059ce` docs-only, `88bd7300` 6 code conflicts |
| `80e5dcce` | compute job results served as ZIP (`yazl`/`yauzl`) | 2 conflicts (`compute_engine_docker.ts`, `compute.test.ts`) — **see §6, client-breaking** |
| `efe1c9e7` | `getStreamableLogs` gains `consumerAddress` + validation | **clean** |
| `2f82c748`, `dc42c5e5`, `b9dd0334` | `await` fix, system/integration test fixes | clean |
| already in `main` | `#1478` `c974bd7f`, `#1487` `870a211f`, `#1490` `ca161f23`, `bf075775` | skip |

Gate: `npm run test:servicesintegration`, service-on-demand smoke (template start/stop/status/result), telemetry dashboards still parse.

### Wave 3 — 4.4.0 / 4.5.0: logs, mirroring, Comfy, Node 24

| commit | change | port status |
|---|---|---|
| `5fcad326` | disk logs by default when no log DB + log-level cleanup | 7 conflicts, indexer processors + `ddoHandler` — **conflicts with our metadata processor** |
| `aab5d791` | returns the key on push-config response | **clean** |
| `17d79ee9` | HF mirroring support (`SERVICE_HF_MIRROR_URL`) | 3 conflicts |
| `259debb3` | `hfpatch/sitecustomize.py` copied into containers (`SERVICE_HF_CLIENT_PATCH`) | 14 conflicts (Dockerfile, docs, services) — mostly additive |
| `d6cccefe` `#1494` | Comfy model download status | 9 conflicts (service types + engine) |
| `bd5821c1` `#1529` | Node 24.22.1 | **clean** — take it, `.nvmrc` 24.x stays |
| `6f694644` `#1532` | output archive test fix | 1 test conflict |
| already in `main` | `#1481` `9f55c031` (ddo-js 1.0.0), `#1484` `4f5db0c2` | skip |

Gate: unit + integration suites, HF-mirror download smoke on a GPU node.

### Wave 4 — 4.6.0: resource limits (decide before porting)

| commit | change | port status |
|---|---|---|
| `4eb8e5f5` + `2ab21cfe` | disk-limit check for services, no start at 0 disk | 7 + 2 conflicts (engine, `service/utils.ts`, `sqliteCompute.ts`) |
| `29b2a80c` `#1544` | `PASS_CONTAINER_ENVS` injected into every container (owner overrides author env) | 9 conflicts, docs-heavy |
| `71b9bd25` `#1543` | `memoryTotal` required for `type: "gpu"` | 2 conflicts (`config/schemas.ts`, `config.test.ts`) — **config-breaking for existing GPU nodes** |
| `1d13ae47` | revert metrics changes + review fixes | 6 conflicts |
| `1fdce009` `#1547` | Node 26.12.1 | **defer** (see §6) |

Gate: config-compat test with our production `config.json`, one C2D run under a disk/VRAM limit.

### Dependency bumps (independent of waves)

`@oceanprotocol/ddo-js` already at `^1.0.0` via `#1481`. Remaining: `express 5.2.1→5.3.0`, `zod 4.4.3→4.6.6`, `mocha 11→12`, `@aws-sdk/client-s3`, the `@libp2p/*` set, `typescript-eslint`, `prettier`. Take them **last**, in one PR, after `package-lock` conflicts from the waves are resolved (`package-lock.json` is our second most-conflicted file, +225/−327).

---

## 5. Backlog older than v4.2.0 — triage rule, not a port list

425 upstream-only patches still differ in content, 343 of them predate the 4.0.0 refactor. Porting them commit-by-commit would re-introduce code that 4.0.0 deleted or moved, and would fight our own implementations (signature/AA, order validation, DDO handling, admin access-list — all areas where we wrote the code instead of cherry-picking).

Rule:

1. **Ignore** anything whose subject is `chore:`, `fix: fix`, `fix: lint`, `fix: tests`, `merge …`, `till <sha>` — those are sync plumbing.
2. **Ignore** anything in an area where our patch set already implements the behaviour (see §3) unless a CVE/exploit path is described in the PR body.
3. **Check individually** only the security-flavoured patches from 2025-12 → 2026-06 that predate our implementations: `200c94c9` smart-account signature, `9919f6b7` admin handler smart-wallet signatures, `f44e6728` auth-token smart account, `17607bfa` validateDDO signature, `95d8e41b` signature validation, `7d9453b3` signature on encrypt handlers, `564decf5` `dockerRegistrysAuth`, `f2c5f533` secure docker, `65a89dc0` C2D image security. For each: diff against our current file and keep only the missing check.
4. **Never** backport refactors (`#1408` *Next major version*, 229 files): we are already on the post-refactor tree.

---

## 6. Do not port / needs a product decision

| item | why |
|---|---|
| Compute outputs **TAR → ZIP** (`80e5dcce`, `88bd7300`) | upstream's own docs say *"Deploy ZIP/TAR-compatible clients before upgraded nodes"*. `enterprise-market` and any consumer that un-tars `results[].file` will break. Port it behind a flag, or coordinate a client release first. |
| `memoryTotal` **required** for GPU resources (`#1543`) | nodes with existing `DOCKER_COMPUTE_ENVIRONMENTS` stop booting. Ship with a warning-only validation first, or migrate every deployment config in the same release. |
| Node **26.12.1** (`#1547`) | `.nvmrc`, Dockerfile and CI move to 26. Our images, `node:sqlite` usage and native deps are validated on 24. Take 24.22.1 now; evaluate 26 separately. |
| `PASS_CONTAINER_ENVS` (`#1544`) | lets the owner override algorithm env — a security-policy decision for a dataspace operator, not a bug fix. |
| `.github/workflows/docker.yml` / `ci.yml` / `codeql.yml`, `ai-instructions/`, `.claude/agents/`, `controlpanel/` | enterprise-specific CI and tooling; upstream's versions publish to upstream registries. |
| `did:op`-only paths in `#1527` | our DDO layer also accepts `did:ope`; take the fix but keep our ID handling. |

## 7. Impact on `deltaDAO/enterprise-market` and the OE stack

- **HTTP surface**: only one new route (`GET /api/services/serviceResult`, authenticated, owner-scoped). Everything else in the window is additive fields on service/compute structures: job `metadata` bag (`#1464`), `min`/`max` service duration (`#1469`), optional integer `order` for templates (`#1490`), `outputArchives` on `serviceStatus`, `results[].type: "output"`.
- **DDO**: `@oceanprotocol/ddo-js` 1.0.0 already in `main`; new service fields are optional, so older DDOs keep validating. `did:ope` handling stays ours.
- **Auth/signature**: `#1484` (ERC-1271 fallback across all configured networks) and the legacy-message fix `69785857` are already in `main` — nothing new to do.
- **Breaking risk to market**: ZIP outputs (above) and, if `#1543` lands, GPU nodes refusing to boot. Both are deployment-time, not API-shape, breaks.

## 8. Execution mechanics

- One branch per wave: `feat/sync-2026-11-w1` … `-w4`, merged into `feat/stage` then `main` (repo convention).
- Port with `git cherry-pick -x <sha>` (keeps the upstream SHA in the message — needed for the next sync's `--cherry-mark` accounting). Group tightly coupled commits (service status: 8 commits, service outputs: 6) into one apply + a single review.
- Conflict policy: **our patch set wins on semantics, upstream wins on structure.** Concretely: if a conflict is inside `validateOrders.ts`, `startCompute.ts`, `MetadataEventProcessor.ts`, `ddoHandler.ts`, `adminHandler.ts`, re-read both sides and keep our behaviour, adding upstream's new checks; everywhere else take upstream's file and re-apply our small hunks (+1/+4 line deltas).
- After each wave: `npm run build`, `npm run lint`, `npm run test:unit`, `npm run test:integration:light`, then the wave-specific suite.
- After all waves, re-run the accounting: `git rev-list --cherry-mark --left-right --no-merges HEAD...upstream/main | cut -c1 | sort | uniq -c`. Success = the `>` count drops from 453 to < 100 and `git diff --shortstat upstream/main HEAD` no longer shows files we never intentionally touched.

## 9. Open questions

1. ZIP outputs: flag (`COMPUTE_OUTPUT_FORMAT`)? or coordinate a market/client release before enabling?
2. `memoryTotal` required: accept the config migration, or land it as a warning for one release?
3. `PASS_CONTAINER_ENVS`: allowed in datacenter deployments (where the operator already owns the host) and blocked in shared ones?
4. Do we keep cherry-picking forever, or move `main` to a real merge of upstream tags with our patch set rebased on top (needs the §3 files re-audited once)?

---

## 10. Wave 1 execution log

Branch `feat/sync-2026-11-w1`, off `main` (`35b864f6`). Commits, in upstream order:

| commit | subject | outcome |
|---|---|---|
| `1243fc31` | security updates `#1495` | dependabot.yml taken as-is; `ci.yml`/`docker.yml` kept ours, adopted upstream's hardening (`permissions: contents: read`, `persist-credentials: false` on every checkout, action majors bumped to checkout/setup-node v7, cache v6, upload-artifact v7, download-artifact v8, setup-buildx v4, login v4, build-push v7) |
| `5c45be24` | bind C2D algorithm container to its DDO `#1527` | applied without conflict (1 497-line rewrite of `startCompute.ts` + new `bindAndChecksumAlgorithm` in `compute/utils.ts`) |
| `af658446` | fix logging leak `#1528` | conflicts in `validateCommands.ts`(+test), `OceanNode.ts`, `httpRoutes/compute.ts` — resolved below |
| `4640866c` | orphaned jobs `#1472` | clean |
| `436c484a` | compute order payer binding `#1531` | conflict in `validateOrders.ts` only — reconciled below |
| `a5f1a585` | isolate C2D inputs per index `#1534` | clean |

Resolution decisions worth knowing:

- **`#1528` restored a weakening of ours.** Our tree had dropped the deep credential redaction
  in `validateCommands.ts` (only top-level `SENSITIVE_COMMAND_FIELDS` were redacted) together with
  its 6 unit tests. Taking upstream's side restores recursive redaction, adds `headers`,
  `accessKeyId`, `secretAccessKey`, `rawcode`, makes key matching case-insensitive, strips
  credentials/query strings out of URL-valued strings, and exports `redactCommandForLogging` for
  the P2P paths. Net effect: strictly stronger than both sides. The `httpRoutes/compute.ts`
  conflict was resolved by keeping our routes (upstream's side of that hunk also carries the
  `GET /api/services/serviceResult` route, which belongs to wave 2) and applying only the
  `sanitizeLogValue` replacements to the log lines we actually have.
- **`#1531` reconciled, our semantics kept.** `validateOrders.ts`: kept the per-event datatoken
  resolution (`event.log.address` + per-event `getERC721Address()` inside the try/catch, tolerant
  of unreadable datatokens) and added upstream's env-AND binding
  (`consumer === userAddress && payer === payerAddress`, with `!== undefined` so an empty payer
  fails closed). Upstream's call sites are intact: `startCompute.ts` (paid: inside the shared
  `validateAssets` loop via the `authorizeAsset` hook; free: new `authorizeAsset` callback),
  `initialize.ts` and the free-path early resolve of the environment.
  The ported unit test mocks receipt logs as `{topics, data}` only; because our validator reads the
  emitting address per event, the mock now also sets `address` (as a real receipt always does).
- **`#1527` did not clobber the enterprise patch set.** Verified after the apply:
  `isConfidentialChainDDO` / `getFilesObjectFromConfidentialEVM` / template-4 decrypt and the
  `canDecrypt` guard now live once in `CommonComputeHandler.validateAssets` (both paid and free
  paths go through it), `getAlgoChecksums` + `validateAlgoForDataset` survive, and
  `EnterpriseFeeCollector`, `did:ope`, `allowedAdminsList` are untouched.

Gates actually run (host node **26.7.0**; the repo pins 24.19.0 in `.nvmrc`, no 24.x on this box —
worth re-running in CI):

| gate | result |
|---|---|
| `npm run build` | pass |
| `npm run lint` (`tsc --noEmit` included) | 0 errors, 67 warnings (identical to the pre-sync baseline) |
| `npm run test:unit` | **404 passing, 2 failing** — the same two failures as the untouched baseline: `networking.test` before-all (`OceanP2P.start`, libp2p listener unavailable here) and `logging.test` after-all (`Invalid PRIVATE_KEY`). `bail: true` in `.mocharc.json` stops the run at the first of them, same as baseline. |
| `npm run test:computeunit` | 141 passing, 0 failing |
| `npm run test:computeintegration` | **cannot run here**: fails in `before all` on `global.oceanContracts` — no Barge stack / `ADDRESS_FILE` / `~/.ocean/ocean-contracts/artifacts/address.json` on this host |
| C2D smoke (1 paid + 1 free) against the point-5 stack | **pending** — same missing stack |
| `npm run test:unit`, `npm run test:servicesintegration` | services suite belongs to wave 2 |

Open before merge: push the branch and get the two integration gates (compute + C2D smoke) run
where Barge is available; re-run the unit baseline on Node 24.19.0 to confirm the two environmental
failures behave the same there.
