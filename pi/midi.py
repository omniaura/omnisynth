'''
author: Omar Barazanji
description: midi communication via pygame.midi module.

source:
https://www.pygame.org/docs/ref/midi.html

'''

import pygame.midi

class OmniMidi:

    def __init__(self, debug=False):
        self.run = True  # flag for opening stream.
        self.debug = debug  # flag for verbose mode.

        pygame.midi.init() # initialize the midi module.
        self.dev_id = pygame.midi.get_default_input_id() # gets default device num.
        
        # Input used to get input from midi devices.
        self.dev = pygame.midi.Input(self.dev_id) 


    def input_stream(self):
        num_events = 1
        self.idle = False
        self.evnt = []
        while(self.run):
            # reads num_events midi events from the buffer.
            self.raw_stream = self.dev.read(num_events) # empty when idle
            try:
                self.evnt = self.raw_stream[0][0]
                self.midi_status = self.evnt[0]
                self.idle = False
                print(self.evnt)
            except IndexError:  # IndexError when idle.
                self.idle = True
                continue


    def stop_stream(self):
        self.run = False

if __name__ == "__main__":
    main_midi = OmniMidi(debug=True)
    main_midi.input_stream()
