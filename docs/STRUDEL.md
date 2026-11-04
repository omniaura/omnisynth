# Strudel experiment alongside Tone

Choose **Strudel** in the transport's **Music engine** selector. Evaluate the
synth demo to hear layered music without downloading samples, or write your
own Strudel code. Ctrl/Cmd+Enter evaluates; Stop stops playback.
The original Tone DAW, tracks and project files remain available.
Switching engines stops both before another is played.

The producer receives a Strudel-specific composition instruction when Strudel
is selected. It writes real upstream Strudel code with evaluate_strudel,
receives evaluation errors, and can inspect strudel_status (events, context
state, RMS and frequency bands). The same tools appear in the local MCP
catalog. This does not add a cloud-to-desktop relay to Ditto chat agents.

Strudel 1.3.0 runs in an HTTP-origin frame without Electron preload, separate
from the privileged file-origin app. No account key or bridge bearer token is
sent into that frame. Static frame assets are served from the packaged app;
authenticated tool routes continue to refuse browser Origin headers.
Strudel supports JavaScript, so run code you trust. Public sample banks may
make HTTPS requests and have their own asset licenses. No external samples
are preloaded; the supplied demo uses synthesis.

Hydra receives measured frequency bands from whichever engine is selected.
Strudel's draft is saved locally. Song save/export includes both Tone state
and the Strudel code; loading restores code without executing it.
Agent generation shares project context with the configured inference
provider, as with the existing DAW.

This is an experiment, not Tone/Strudel project conversion or shared sample
clock synchronization. The root AGPL license and packaged dependency source
and notices cover the new integration; upstream notices are retained.
The dependency bundle contains published npm package contents. For public
distribution, also verify preferred-form upstream source availability for
bundled/precompiled dependencies; this experiment does not clear that gate.
