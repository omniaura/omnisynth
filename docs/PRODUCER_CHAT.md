# Producer conversation

The producer is a continuing local conversation. Sending a message preserves
previous exchanges instead of replacing the run log. Messages, tool transcripts
and cancellation state are stored in the app's IndexedDB profile; raw attachment
bytes are not duplicated into that history. The composer draft and selected
music engine survive reload without automatically starting playback.

The visible timeline loads recent turns and offers Earlier messages. The model
gets complete recent tool-call/result batches within a bounded context window.
Large transcripts are condensed in the model window; the originals remain on
disk. `search_conversation_history` scans older turns and
`read_conversation_turn` retrieves a selected exchange. Storage is limited by the
device, rather than by a fixed conversation-turn limit. Storage failures are
shown explicitly. Cancelling or reopening never resumes an action automatically.

The current OpenAI-compatible provider bridge and DAW dispatcher remain in use.
The evaluated ditto-assistant/ditto-harness Node binding currently supplies a
memory-only chat toolset; migrating requires a DAW callback binding and shipping
the native addon. This feature does not claim to import that agent loop.

The paired Desktop integration supplies turn-scoped music tools to regular
Ditto cloud chat through an outbound native connection. Its localhost bearer
token remains on the Mac. That integration needs the paired backend deployment
and Desktop build; the local producer does not depend on that rollout.

QA uses `scripts/conversation-smoke.mjs` with an isolated profile and a
deterministic model fixture. It checks actual engine dispatch, conversation
context, syntax recovery, cancellation and reloads. Real provider prompt QA is a
separate check; fixture responses do not prove a model can compose good music.
