/*
desc: A patch with added features!
date: 2/16/21
*/

/*
Synth function.
*/
SynthDef.new(\tone6, {

~number_of_user_sine_oscillators=2;
~user_frequency_shift=[0,10];
	arg freq=440, amp=0.6, gate=0, bend=0;
	var final_signal, sig1, sig2, env;
	var user_sin_oscillator=Array.new(maxSize: number_of_user_sine_oscillators);
	/* generate the user designed sinewave generators*/
	for (1, number_of_user_sine_oscillators, {
		arg i;
		user_sin_oscillator(i)=SinOsc.ar(freq+user_frequency_shift, phase: 0.0, mul: 1.0, add: 0.0);
		i.postln;
	});

	env = EnvGen.kr(Env.adsr, gate, doneAction:2);
	final_signal=user_sin_oscillator*env
	Out.ar(0, final_signal)

}).store;