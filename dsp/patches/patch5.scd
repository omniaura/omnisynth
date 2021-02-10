/*
desc:
date: 1/21/21
*/

/*
Synth function.
*/
SynthDef.new(\tone5, {
	arg freq=440, amp=0.6, gate=0, bend=0;
	var sig, sig1, sig2, env;
	sig1 = Spring.ar(Formant.ar(freq * bend.midiratio, 500,200), 1, 0.5)!2; /* !1 mono, !2 stereo...*/
	sig2 = Ball.ar(SinOsc.ar(freq * bend.midiratio, 500,200), 0.2, 0.5)!2;
	env = EnvGen.kr(Env.adsr, gate, doneAction:2);
	sig1 = sig1 * env * amp;
	sig2 = sig2 * env * amp;
	sig = sig1 + sig2;
	Out.ar(0, sig);
}).store;

