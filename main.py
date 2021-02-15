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

        # initial
        self.sc = OmniCollider()

        # holds midi messages from UDP stream
        self.evnt = []

        # used for midi learn
        self.midi_learn_on = False
        self.knob_table = dict()

        # Table that will be outputted to DAC & Mux
        self.cv_table = [[0 for x in range(8)] for y in range(4)] 


    # opens UDP stream for MIDI control messages
    def open_stream(self):
        self.sc.receive("/control")
        self.evnt = self.sc.midi_evnt
        if self.midi_learn_on:
            self.midi_learn(self.evnt)

    # implement a way to close stream (may be on GUI)
    def close_stream(self):
        pass

    # update every 10ms
    def update_cv(self):
        # DAC & Mux update period is 10/32 ms
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

    # turns on / off synthDef's from SC
    def synth_sel(self, synth_name):
        command = "/omni"
        control = "synthSel"
        self.sc.transmit(command, control, synth_name)

    # select filter and param value
    def filter_sel(self, filter_name, value):
        command = "/omni"
        control = "filterSel"
        self.sc.transmit(command, control, filter_name, value)

    # creates dict for all control knobs on MIDI controller
    def midi_learn(self, midi_msg):
        if len(midi_msg) == 4:
            val = midi_msg[1]
            src = midi_msg[2]
            chan = midi_msg[3]
            self.knob_table[(src,chan)] = val


if __name__ == "__main__":
    OmniSynth = Omni() # initialize Omni class.
    OmniSynth.sc_compile() # compiles all synthDef's 

    # uncomment below to test midi_learn for knobs

    # OmniSynth.midi_learn_on = True # turn on midi learn
    # while (True):
    #     OmniSynth.open_stream()

    OmniSynth.synth_sel("tone1")
    OmniSynth.filter_sel("lpf", 20000)
    OmniSynth.filter_sel("hpf", 20)
