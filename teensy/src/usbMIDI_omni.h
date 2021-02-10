// Author: Jacob Parmer
// Date: Feb 10, 2021

class omniMIDI {

	public:

		omniMIDI();

		bool read();
		
		// callback functions
		static void omniNoteOn(byte channel, byte note, byte velocity);
		static void omniNoteOff(byte channel, byte note, byte velocity);
		static void omniAfterTouchPoly(byte channel, byte note, byte velocity);
		static void omniControlChange(byte channel, byte control, byte value);
		static void omniProgramChange(byte channel, byte program);
		static void omniAfterTouch(byte channel, byte pressure);
		static void omniPitchChange(byte channel, int pitch);
		static void omniSystemExclusiveChunk(const byte *data, uint16_t length, bool last);
		static void omniSystemExclusive(byte *data, unsigned int length);
		static void omniTimeCodeQuarterFrame(byte data);
		static void omniSongPosition(uint16_t beats);
		static void omniSongSelect(byte songNumber);
		static void omniTuneRequest();
		static void omniClock();
		static void omniStart();
		static void omniContinue();
		static void omniStop();
		static void omniActiveSensing();
		static void omniSystemReset();
		static void omniRealTimeSystem(byte realtimebyte);


};

omniMIDI::omniMIDI() {
    
    usbMIDI.setHandleNoteOn(omniNoteOn);
    usbMIDI.setHandleNoteOff(omniNoteOff);
    usbMIDI.setHandleAfterTouchPoly(omniAfterTouchPoly);
    usbMIDI.setHandleControlChange(omniControlChange);
    usbMIDI.setHandleProgramChange(omniProgramChange);
    usbMIDI.setHandleAfterTouch(omniAfterTouch);
    usbMIDI.setHandlePitchChange(omniPitchChange);
    usbMIDI.setHandleSystemExclusive(omniSystemExclusiveChunk);
    usbMIDI.setHandleTimeCodeQuarterFrame(omniTimeCodeQuarterFrame);
    usbMIDI.setHandleSongPosition(omniSongPosition);
    usbMIDI.setHandleSongSelect(omniSongSelect);
    usbMIDI.setHandleTuneRequest(omniTuneRequest);
    usbMIDI.setHandleClock(omniClock);
    usbMIDI.setHandleStart(omniStart);
    usbMIDI.setHandleContinue(omniContinue);
    usbMIDI.setHandleStop(omniStop);
    usbMIDI.setHandleActiveSensing(omniActiveSensing);
    usbMIDI.setHandleSystemReset(omniSystemReset);
    usbMIDI.setHandleRealTimeSystem(omniRealTimeSystem);
}

bool omniMIDI::read() {
    return usbMIDI.read();
}

// TEMP: Turns onboard LED on with note on signals, and off with note off signals.
void omniMIDI::omniNoteOn(byte channel, byte note, byte velocity) {
    digitalWrite(LED_BUILTIN, HIGH);
    return;
}

void omniMIDI::omniNoteOff(byte channel, byte note, byte velocity) {
    digitalWrite(LED_BUILTIN, LOW);
    return;
}

void omniMIDI::omniAfterTouchPoly(byte channel, byte note, byte velocity) {
    return;
}

void omniMIDI::omniControlChange(byte channel, byte control, byte value) {
    return;
}

void omniMIDI::omniProgramChange(byte channel, byte program) {
    return;
}

void omniMIDI::omniAfterTouch(byte channel, byte pressure) {
    return;
}

void omniMIDI::omniPitchChange(byte channel, int pitch) {
    return;
}

void omniMIDI::omniSystemExclusiveChunk(const byte *data, uint16_t length, bool last) {
    return;
}

void omniMIDI::omniSystemExclusive(byte *data, unsigned int length) {
    return;
}

void omniMIDI::omniTimeCodeQuarterFrame(byte data) {
    return;
}

void omniMIDI::omniSongPosition(uint16_t beats) {
    return;
}

void omniMIDI::omniSongSelect(byte songNumber) {
    return;
}

void omniMIDI::omniTuneRequest() {
    return;
}

void omniMIDI::omniClock() {
    return;
}

void omniMIDI::omniStart() {
    return;
}

void omniMIDI::omniContinue() {
    return;
}

void omniMIDI::omniStop() {
    return;
}

void omniMIDI::omniActiveSensing() {
    return;
}

void omniMIDI::omniSystemReset() {
    return;
}

void omniMIDI::omniRealTimeSystem(byte realtimebyte) {
    return;
}

