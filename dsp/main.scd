/*
desc: Mellotron-like patch.
date: 1/16/21
*/

// Config and global variables
s.boot;

~bend = 8193;
~notes = Array.newClear(128);

// Default patch
~synth = "tone1";
~lpf_cutoff = 20000;
~hpf_cutoff = 20;

// Set freq to standard Hz
nil.set(\freq, 880);

// Grab any MIDI device plugged in.
MIDIClient.init;
MIDIIn.connectAll;

// Connection to OSC
n = NetAddr.new("127.0.0.1", 7771);

// begin main
(

/* OSCFunc called when Python sends "/omni" a message.
 * This function will control the OmniSynth created in Python.
 */
o = OSCFunc( {

	// arguments to OSCFunc
	| msg, time, addr, recvPort |

	// post all messages to terminal window
	[msg, time, addr, recvPort].postln;

	case

		{msg[1] == "synthSel".asSymbol} {
			~synth = msg[2].asString;
	        ~synth.postln;
		}

		{msg[1] == "filterSel".asSymbol} {
			if (msg[2] == "lpf".asSymbol) {
				~lpf_cutoff = msg[3].asFloat;
			};
			if (msg[2] == "hpf".asSymbol) {
				~hpf_cutoff = msg[3].asFloat;
			};
		}

		{msg[1] == "compile".asSymbol} {
			msg[2].asString.load;
		}

		{true} {~synth = "tone1"};

	~notes = Array.newClear(128);

}, '/omni');


/*
Note on function.
*/
MIDIdef.noteOn(\noteOnDef, {
	arg vel, nn, chan, src;
	[vel, nn].postln;
	n.sendMsg("/noteOn", nn);
	~notes[nn] = Synth.new(
		~synth,
		[
			\freq, nn.midicps,
			\amp, vel.linexp(1,127,0.01,0.03),
			\gate, 1,
			\bend, ~bend.linlin(0,16383,-2,2),
			\lpf_cutoff, ~lpf_cutoff,
			\hpf_cutoff, ~hpf_cutoff,
		]
	);
});

/*
Note off function.
*/
MIDIdef.noteOff(\noteOffDef, {
	arg vel, nn;
	[vel, nn].postln;
	~notes[nn].set(\gate, 0);
	~notes[nn] = nil;
});

/*
Pitch wheel function.
*/
MIDIdef.bend(\bendDef, {
	arg val, chan;
	[val, chan].postln;
	~bend = val;
	~notes.do{arg synth; synth.set(\bend, val.linlin(0,16383, -2, 2))};
}, chan:0);

MIDIdef.cc(\controlDef, {
	arg val, src, chan;
	[val, src, chan].postln;
	n.sendMsg("/control",val, src, chan);

});

) // end main
