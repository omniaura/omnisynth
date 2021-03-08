// Author: Jacob Parmer
// Date: Mar 8, 2021

#define NOTE_OFF 0x80
#define NOTE_ON 0x90
#define AFTERTOUCH 0xA0
#define CONTIN_CONTROL 0xB0
#define PATCH_CHANGE 0xC0
#define CHANNEL_PRESSURE 0xD0
#define PITCH_BEND 0xE0

#define MIDI_PACKET_SIZE 3

class OmniMIDI {

    public:
        OmniMIDI();
        void read();
        void omniNoteOn();
        void omniNoteOff();

    private:
        byte last_received_packet[MIDI_PACKET_SIZE];

};

OmniMIDI::OmniMIDI() {
    return;
}

void OmniMIDI::read() {

    while (Serial.available() != 0) {

        if ((Serial.available() % MIDI_PACKET_SIZE) == 0) {

            Serial.println(Serial.available());

            byte header = Serial.read();
            byte data1 = Serial.read();
            byte data2 = Serial.read();

            if (header == NOTE_ON) {
                this->omniNoteOn();
            } 
            else if (header == NOTE_OFF) {
                this->omniNoteOff();
            }

            last_received_packet[0] = header;
            last_received_packet[1] = data1;
            last_received_packet[2] = data2;

        } else {
            Serial.println("Invalid packet size. Flushing...");
            while (Serial.available()) {
                Serial.read();
            }
        }
    }
}

void OmniMIDI::omniNoteOn() {
    digitalWrite(LED_BUILTIN, HIGH);
}

void OmniMIDI::omniNoteOff() {
    digitalWrite(LED_BUILTIN, LOW);
}
