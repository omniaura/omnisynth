'''


'''

import midi
from midi import MidiConnector 
from midi import Message, NoteOff, NoteOn
import time

class OmniMidi:

    def __init__(self):
        self.conn = MidiConnector('/dev/ttyACM0')

    def send_msg(self):
        note_on = NoteOn(77, 100)
        note_off = NoteOff(77, 0)
        msg1 = Message(note_on,2)
        msg2 = Message(note_off,2)
        self.conn.write(msg1)
        time.sleep(1)
        self.conn.write(msg2)

if __name__ == "__main__":
    Midi = OmniMidi()
    Midi.send_msg()