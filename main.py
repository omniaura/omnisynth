"""
Main / Top Level for the OmniAura Synthesizer.

author: Omar Barazanji
date: 11/12/20

Python 3.7.x
"""

import numpy as np
import os

# used for grabbing all midi data (in parallel with supercollider)
from pi.midi import OmniMidi

# Used for sending / receiving data from supercollider.
from pi.osc import OmniCollider

class Omni():

    def __init__(self):
        self.sc = OmniCollider()
        # Table that will be outputted to DAC & Mux
        self.cv_table = [[0 for x in range(8)] for y in range(4)] 
        
    # update every 10ms
    def update_cv(self):
        # DAC & Mux update period is 10/32 ms
        pass
    
    # opens midi input stream
    def open_stream(self):
        self.midi_stream = OmniMidi(debug=True) # change to False to turn off verbose
        self.midi_stream.input_stream()

    def close_stream(self):
        self.midi_stream.stop_stream()

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

    def filter_sel(self, filter_name, value):
        command = "/omni"
        control = "filterSel"
        self.sc.transmit(command, control, filter_name, value)


if __name__ == "__main__":
    
    OmniSynth = Omni() # initialize Omni class.
    OmniSynth.sc_compile() # compiles all synthDef's 

    OmniSynth.synth_sel("tone1")
    OmniSynth.filter_sel("lpf", 20000)
    OmniSynth.filter_sel("hpf", 20)
