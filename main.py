"""
Main / Top Level for the OmniAura Synthesizer.

author: Omar Barazanji
date: 11/12/20

Python 3.7.x
"""

import numpy as np
import os

# Used for sending / receiving data from supercollider.
from pi.osc import OmniCollider

class Omni():

    def __init__(self):

        # initialize OSC module for UDP communication with Supercollider.
        self.sc = OmniCollider()

        # holds midi messages from UDP stream.
        self.evnt = []

        # used for turning on midi learn.
        self.midi_learn_on = False

        # holds all control knobs and their values.
        #     organization: self.knob_table[knob_addr] = value
        #     where knob_addr = (src, chan) from the MIDI cc knob.
        self.knob_table = dict()

        # holds all knob mappings to SC params.
        #     organization: self.knob_map[knob_addr] = filter_name.
        self.knob_map = dict()

        # Table that will be outputted to DAC & Mux
        self.cv_table = [[0 for x in range(8)] for y in range(4)] 

        # LUT for freq control messages, maps 0-127 to 20 - 20000 Hz.
        self.cc_to_freq = np.linspace(20,20000,128).tolist()



    # opens UDP stream for MIDI control messages.
    def open_stream(self, *args):
        self.sc.receive("/control")
        self.evnt = self.sc.midi_evnt
        if self.midi_learn_on:
            self.midi_learn(self.evnt)
        if len(self.knob_map) != 0:
            for knob_addr in self.knob_map:
                filter_name = self.knob_map[knob_addr]
                raw_value = self.knob_table[knob_addr]
                value = self.cc_to_freq[raw_value]
                self.filter_sel(filter_name, value)

    # implement a way to close stream (may be on GUI).
    def close_stream(self):
        pass

    # update every 10ms
    def update_cv(self):
        # DAC & Mux update period is 10/32 ms.
        pass

    # compiles all synthDef's in dsp folder.
    def sc_compile(self):
        command = "/omni"
        control = "compile"
        directory = "dsp/patches/"
        for patch in os.listdir(directory):
            filedir = directory + patch
            path = os.path.abspath(filedir).replace("\\", "/")
            self.sc.transmit(command, control, path)

    # turns on / off synthDef's from SC.
    def synth_sel(self, synth_name):
        command = "/omni"
        control = "synthSel"
        self.sc.transmit(command, control, synth_name)

    # select filter and param value.
    def filter_sel(self, filter_name, value):
        command = "/omni"
        control = "filterSel"
        self.sc.transmit(command, control, filter_name, value)

    # creates dict for all control knobs on MIDI controller.
    def midi_learn(self, midi_msg):
        if len(midi_msg) == 4:
            val = midi_msg[1]
            src = midi_msg[2]
            chan = midi_msg[3]
            self.knob_table[(src,chan)] = val

    # maps a knob to an SC parameter.
    # params:
    #     knob_addr = (src, chan) 
    #     filter_name = "lpf" (for example)
    def map_knob(self, knob_addr, filter_name):
        self.knob_map[knob_addr] = filter_name


if __name__ == "__main__":
    OmniSynth = Omni() # initialize Omni class.
    OmniSynth.sc_compile() # compiles all synthDefs.

    # uncomment below to test midi_learn for knobs.

    # OmniSynth.midi_learn_on = True # turn on midi learn.
    # while (True):
    #     OmniSynth.open_stream()

    #     # After midi_learn is complete, the GUI runs:
    #     # for example:
    #     #     OmniSynth.map_knob((7,1), "lpf")   

    OmniSynth.synth_sel("tone1")
    OmniSynth.filter_sel("lpf", 20000)
    OmniSynth.filter_sel("hpf", 20)
