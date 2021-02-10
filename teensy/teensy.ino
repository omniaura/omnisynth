//#include <FastLED.h>
#include "src/config.h"
#include "src/usbMIDI_omni.h"

Config cfg;
omniMIDI thisMidiDevice = omniMIDI();


void setup() {
	delay(3000); // safety check while powering up
  pinMode(LED_BUILTIN, OUTPUT);
  cfg = load_configuration();

}

void loop() {
  // put your main code here, to run repeatedly:
 
  /* midi_recvd, midi_msg = checkForMidiUpdates();
   * 
   * UpdateLEDs(midi_recvd, midi_msg)
   * 
   * displayLEDs();
   * 
   */

    thisMidiDevice.read();
    
}
