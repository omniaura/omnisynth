/*
desc: Mellotron-like patch.
date: 1/16/21
*/

/*
Synth function.
*/
SynthDef.new(\tone3, {
	arg freq=440, amp=0.6, gate=0, bend=0;
	var sig, env;
	sig = SinOscFB.ar(freq * bend.midiratio)!2; /* !1 mono, !2 stereo...*/
	env = EnvGen.kr(Env.adsr, gate, doneAction:2);
	sig = sig * env * amp;
	Out.ar(0, sig);
}).store;
