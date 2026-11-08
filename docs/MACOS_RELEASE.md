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
`CSC_LINK` is the CI certificate input. For an existing local notarytool
keychain profile, set `APPLE_KEYCHAIN_PROFILE` (and optionally `APPLE_KEYCHAIN`).
Alternatively, `APPLE_API_KEY` must point to a `.p8` file, accompanied by
`APPLE_API_KEY_ID` and `APPLE_API_ISSUER`. Mixing credential modes is rejected.
The profile name must be identified by the owner; its presence is not assumed.
Credentials
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

The owner selected AGPL-3.0-only for the full Electron app on 2026-11-04.
The root LICENSE and package metadata now agree. Hydra is retained; the
current DAW uses Tone.js and includes a separate Strudel live-code surface.
The original MIDI Gen MIT notice is retained in `third-party/`.
Packaging includes this checkout's application source, installed production
dependency source, dependency inventory and license notices under
`Contents/Resources/licensing/`. See [LICENSING.md](LICENSING.md).
Electron's own license and Chromium notices remain in its packaged resources.
The independent Bevy experiment retains its own MIT license.

AGPL selection does not publish the private repository, configure signing
secrets, notarize a package or activate an updater. Validate matching source,
dependency notices and any additional asset terms before public distribution.

## Release closeout (2026-11-08)

The full Electron candidate now integrates the selected Light loom icon from
main commit `c1f420863b14f423bb4b02ea91f739b83239f6c5`. Artifact verification
compares the icon in the built app, DMG and ZIP to `build/icon.icns`, and records
its SHA-256 in provenance. The selected icon hash is
`9d94363ab870b79a8f972fcab737a2d4fa846769df058666e96109fc97ff77fc`.
Both unsigned and signed workflows exercise the continuing-conversation fixture.

The November 4 package failure came from a later bridge review suggestion that
used a tool result before its declaration and removed the local-history guard.
The closeout restores the guard and records completed external calls only while
the Producer is idle. Solid is pinned to 1.9.18, carrying the reviewed
serialization dependency correction into the full Electron candidate.

Read-only preflight on November 8 found a valid local Omni Aura Developer ID
identity, but no repository/organization signing secrets or release environment
in `omniaura/omnisynth`. These observations do not prove private-key use,
notarization, or a signed release. The owner setup above remains the precise
credential gate; do not copy credentials from Ditto or weaken the environment
policy to make a release run. The installed app with a manually replaced icon
remains an unsigned QA candidate until a complete signed artifact passes
verification.

The closeout also checks that a completed question answer makes only one
model request and that a delayed older Strudel evaluation cannot stop a newer
pattern. Both checks failed against the prior candidate and passed after
restoring the ordinary-answer return and serializing frame transport commands.
External perception results no longer replace the artist's editable brief.
Stop also bypasses a pending evaluation: a three-second evaluation control
made Stop exceed its deadline before the fix. The current native fixture
requires a prompt stop reply, no frame reset, and stopped playback after the
old evaluation settles. Linux icon generation preserves both committed ICNS
files instead of replacing the selected Mac encoding.

macOS run 42529595791 passed build, DMG/ZIP/icon verification, packaged UI and
the conversation fixture, then failed only because GitHub's artifact storage
quota prevented retention. That run is package-test evidence, not a retained
download, signed/notarized artifact or release. Do not treat quota failure as
permission to delete unrelated artifacts, buy storage or change release policy.

The owner selected protected GitHub signing on November 8. Live organization
metadata reports `omniaura` on Free. Creating `omnisynth-release` with a required
owner reviewer, self-review prevention and disabled administrator bypass returned
HTTP 422 because the billing plan does not support required reviewers. GitHub
left an empty unprotected environment despite the error; its secret list was
empty, and that newly created environment was removed. No signing secret was
uploaded. GitHub's [environment availability documentation](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
requires Enterprise for required-reviewer protection in a private repository;
Team alone does not provide that rule. Owner-managed Enterprise access and
artifact retention remain blockers. Do not silently replace this with an
unprotected environment or repository secrets.

References: [electron-builder v26 macOS options](https://www.electron.build/v26/docs/mac/),
[Electron notarization](https://github.com/electron/notarize),
[Omar signing handoff](https://heyditto.slack.com/archives/D0AV3JCCDN3/p1793566970046399).
