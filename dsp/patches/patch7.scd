/*
desc: FM patch.
author: Omar Barazanji
date: 11/11/20
*/


/*
Synth function.
*/
SynthDef.new("tone7", {

	arg freq=440, lpf_cutoff=20000, hpf_cutoff=20,
		amp=0.6, gate=0, bend=0, out=0,
        mod_freq=1000, mod_amp=500;

	var sig, mod_sig, raw_sig, filter_sig, env,
        carrier, mod;

	/*
	signal creation section.
	*/
	mod_sig = SinOsc.ar(mod_freq * bend.midiratio, mul:mod_amp);
	raw_sig = SinOsc.ar((freq + mod_sig) * bend.midiratio);

	/*
	Envelope section.
	*/
	env = EnvGen.kr(Env.adsr, gate, doneAction:2);

	/*
	Filter section.
	*/
	filter_sig = LPF.ar(raw_sig, lpf_cutoff);
	filter_sig = HPF.ar(filter_sig, hpf_cutoff);

	/*
	Putting all components together.
	*/
	sig = filter_sig * env * amp!2;

	Out.ar(out, sig);
}).store;
