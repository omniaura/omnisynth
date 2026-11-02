# Independent OmniSynth macOS releases (SYNTH-31)

This is an Apple silicon pipeline for the Electron product. `main` still has
the older AuraJam/Tauri prototype; the implementation is stacked above
OmniSynth PR #4 (`synth-53-knowledge-library`). Do not release the Tauri app
under this pipeline or merge the existing product stack as a signing shortcut.

Ditto's current reference is `ditto-assistant/ditto-app`, not the retired
desktop repository. Its Desktop Release run
[41350680972](https://github.com/ditto-assistant/ditto-app/actions/runs/41350680972)
reported successful signing, notarization and DMG verification on November 1,
2026. Its workflow revision differs from its built source revision; this
pipeline builds the dispatched workflow's exact SHA and records both values.
Ditto's source and pipeline are unchanged. No separate releases repository or
cross-repository PAT is needed: drafts belong in `omniaura/omnisynth`.

## Build and review

`bun install --frozen-lockfile` uses `bun.lock` (Electron 39.8.10 and
electron-builder 26.15.3 at implementation time). CI pins Bun 1.3.14 and Node
22.23.4. PR CI builds an explicitly unsigned package without any signing
secrets. On a Mac:

```sh
bun run test:release
bun run dist:unsigned
node scripts/verify-macos.mjs --unsigned
```

`bun run dist` requires Developer ID and notarization credentials. There is no
silent unsigned fallback. It enables hardened runtime, JIT and audio-input
entitlements, signs, and notarizes through electron-builder's v26 support.
`CSC_NAME` can select an existing local identity instead of exporting a key;
`CSC_LINK` is the CI certificate input. `APPLE_API_KEY` must point to a `.p8`
file, accompanied by `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`. Credentials
must stay on the trusted signing Mac or protected macOS release runner, never
on Boat. This task does not export or upload any credential.

Packaging snapshots only compiled frontend/main/preload files and minimal
metadata. No workspace node_modules, env files, credentials or unrelated
source are packaged. The archive subprocess PATH puts `/usr/bin` first and
checks that `ditto` resolves to `/usr/bin/ditto`; `@heyditto/cli` must not
intercept Apple's archiver. Both automatic electron-builder publishing and
update metadata generation are disabled.

Artifacts in `release/`:

* `OmniSynth-0.2.0-mac-arm64.dmg` and `.zip` (version follows package.json).
* `SHA256SUMS.txt`, `provenance.json`, `package-qa.json`, `package-qa.png`.

Verification mounts the DMG read-only, extracts the ZIP with Apple's ditto,
compares executable and ASAR payloads with the original `.app`, checks bundle
and URL identities, and launches the mounted executable. Signed verification
also requires deep/strict codesign, the Omni Aura Developer ID team
`HS4W876DT9`, hardened runtime, Gatekeeper acceptance and a stapled ticket
on all three app copies. SHA256SUMS covers both distributables.

The UI smoke uses a disposable home/profile and no inference credentials. It
exercises Settings, track editing, play/stop controls, bridge state, denial of
unauthenticated/browser-origin bridge requests, and profile persistence after
reload. A neighboring Ditto state fixture must remain byte-for-byte intact.
This is not audio-output, real-account, real-keychain, or simultaneous live
Ditto-process proof. Keep those limits beside a green package run. QA skips
protocol registration so it does not replace the workstation's installed app
association. QA profiles remain under ignored `.tmp/` for diagnosis.

## Owner setup: signing access is a separate step

As of implementation, the local keychain lists a valid Developer ID Application
identity for Omni Aura LLC, but `omniaura/omnisynth` lists no Actions secrets.
An identity listing alone does not prove private-key access or notarization.
Existing Ditto Actions secrets cannot be read back or reused automatically.

1. In [OmniSynth environments](https://github.com/omniaura/omnisynth/settings/environments),
   create `omnisynth-release`. Restrict deployment branches to the reviewed
   release branch (normally `main` after the product stack lands), require
   owner review and prevent self-review where GitHub supports it. This private
   repository may need a GitHub plan upgrade for environment protections;
   verify protection is effective before adding secrets. Do not change plan,
   repository visibility or account settings automatically. If protection is
   unavailable, leave secrets unset and keep signing on the owner's Mac.
2. The owner may explicitly authorize reuse of an existing encrypted `.p12`
   and notarization `.p8`, or export the existing Developer ID identity in
   Keychain Access themselves. Do not mint another certificate or export its
   private key automatically. Store any export outside the checkout with
   owner-only permissions. Do not paste keys/passwords into chat, logs or PRs.
3. Configure these **environment** secrets: `MAC_CSC_LINK` (base64 `.p12`),
   `MAC_CSC_KEY_PASSWORD`, `APPLE_API_KEY_P8` (original `.p8` text),
   `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`. The two identifiers must belong to
   that key. GitHub's environment secret forms are suitable. For an explicitly
   authorized CLI upload, use stdin/files, for example:

   ```sh
   base64 < /owner/private/DeveloperID.p12 | gh secret set MAC_CSC_LINK --repo omniaura/omnisynth --env omnisynth-release
   gh secret set MAC_CSC_KEY_PASSWORD --repo omniaura/omnisynth --env omnisynth-release
   gh secret set APPLE_API_KEY_P8 --repo omniaura/omnisynth --env omnisynth-release < /owner/private/AuthKey_KEYID.p8
   gh secret set APPLE_API_KEY_ID --repo omniaura/omnisynth --env omnisynth-release
   gh secret set APPLE_API_ISSUER --repo omniaura/omnisynth --env omnisynth-release
   gh secret list --repo omniaura/omnisynth --env omnisynth-release
   ```

   Commands without stdin prompt privately. Secret names/listing prove only
   configuration presence. A successful signed run is required to prove values.
4. Once the workflow exists on the default branch and the exact reviewed ref
   is approved, dispatch **OmniSynth Desktop Release** on that ref with
   `create_draft=false`. It retains private Actions artifacts for 14 days and
   removes its temporary `.p8` even on failure. Review signature/notary logs,
   provenance, screenshot and checksums before accepting a candidate.
5. For a reviewable GitHub draft, dispatch with `create_draft=true`. After the
   signed job succeeds, a separate job with `contents: write` downloads only
   that run's artifact, validates provenance/checksums and creates a draft
   prerelease in this repository at the built SHA. A draft remains private
   even if the repository later becomes public. The workflow never publishes
   a draft, makes a repository public, or activates an updater.

If human keychain/passkey access is needed, the owner completes that prompt.
Do not lower keychain protections or move signing credentials to another host
to bypass it. Public publication and credential transfer still require owner
authorization. Re-running creates a distinct candidate by run id; it does not
overwrite another release.

## Coexistence contract

| Surface | OmniSynth | Current Ditto Desktop |
| --- | --- | --- |
| Bundle id | `com.omniaura.omnisynth` | `ai.omniaura.ditto.desktop` |
| App/executable | `/Applications/OmniSynth.app` / `OmniSynth` | `/Applications/Ditto.app` / `Ditto` |
| macOS user data / Chromium profile | `~/Library/Application Support/OmniSynth` | `~/Library/Application Support/Ditto` |
| Encrypted store | own profile's `secrets.json`; Electron safeStorage | Ditto's own identity vault/profile |
| Keychain | Electron app name `OmniSynth` (set before ready) | Electron app name `Ditto` / own passkey group |
| Scheme declared by package | `omnisynth://` | No OmniSynth scheme in Ditto package |
| Bridge | own `bridge.json`, random loopback port and token | client only when integration is available |
| Release home / tag | `omniaura/omnisynth`, `omnisynth-v…` | current Ditto pipeline/repository unchanged |
| Assets | `OmniSynth-…-mac-arm64.*` | `Ditto-…-mac-arm64.*` |
| Update feed | none; no updater dependency or feed | independently managed by Ditto |

Single-instance locking follows OmniSynth's own profile. No shared keychain
access group is added. The existing credential fallback reads CLI or legacy
Ditto account files read-only; this is intentional integration, not shared
storage ownership. It targets legacy `~/.t3` / `~/.ditto` files and does **not**
prove shared sign-in with the current ditto-app identity vault. This change
does not migrate, delete, import or modify those files or change either app's
account. The current Ditto integration needs its own acceptance test.

Before a public candidate is accepted, an owner QA session should install both
apps side by side (preserve any existing installs), launch both, verify each
has its own process/profile and only OmniSynth handles its scheme, restart
both with independent settings, and check real safeStorage keychain service
labels. Do not test against somebody else's account or replace an existing
app without authorization. Intel macOS, Windows and Linux releases are outside
this Apple silicon candidate.

## Licensing evidence and public distribution gate

The current package declares MIT, but the repository has no root LICENSE file.
Its README attributes the ported engine/tool surface to `omarzanji/midi-gen`;
that attribution alone is not a license grant. The current Electron stack
removed Strudel and Tauri. Installed dependency license metadata and retained
notices must be inspected before public distribution, especially Hydra and
its transitive closure. The frozen install inspected on Boat reports
`hydra-synth@1.4.0` license metadata `AGPL`; its installed LICENSE explicitly
says GNU Affero General Public License, Version 3. Electron 39.8.10,
electron-builder 26.15.3, Tone 15.1.22 and Solid 1.9.10 report MIT. This is
direct dependency evidence, not a complete transitive license audit.
Do not assume Ditto's licensing decision covers this
different product. Resolve source-license provenance and required source/
notice delivery with the owner before public publication. Existing logo files
remain technical placeholders; this work grants no brand approval.

References: [electron-builder v26 macOS options](https://www.electron.build/v26/docs/mac/),
[Electron notarization](https://github.com/electron/notarize),
[Omar signing handoff](https://heyditto.slack.com/archives/D0AV3JCCDN3/p1793566970046399).
