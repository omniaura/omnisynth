/*
desc: A patch with added features!
date: 2/16/21
*/

/*
Synth function.
*/


SynthDef.new(\tone6, {
	arg freq=440, amp=0.6, gate=0, bend=0,
		num_use_sine_osc=2, usr_freq_shift = [0,10];
	var final_signal, sig1, sig2, env;
		//user_sin_oscillator=Array.new(maxSize: num_use_sine_osc);
	/* generate the user designed sinewave generators*/
	for (1, num_use_sine_osc, {
		arg i;
		//user_sin_oscillator(i)=SinOsc.ar(freq+usr_freq_shift, phase: 0.0, mul: 1.0, add: 0.0);
		final_signal = final_signal + SinOsc.ar(freq+usr_freq_shift, phase: 0.0, mul: 1.0, add: 0.0);
		i.postln;
	});

	env = EnvGen.kr(Env.adsr, gate, doneAction:2);
	final_signal=user_sin_oscillator*env
	Out.ar(0, final_signal)

}).store;