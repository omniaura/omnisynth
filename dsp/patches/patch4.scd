/*
desc:
date: 1/16/21
*/

/*
Synth function.
*/
SynthDef.new(\tone4, {
	arg freq=440, amp=0.6, gate=0, bend=0;
	var sig, env;
	sig = Formant.ar(freq * bend.midiratio, 500,200)!2; /* !1 mono, !2 stereo...*/
	env = EnvGen.kr(Env.adsr, gate, doneAction:2);
	sig = sig * env * amp;
	Out.ar(0, sig);
}).store;