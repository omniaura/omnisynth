//#include <FastLED.h>
#include "src/config.h"
//#include "src/midi.h"

Config cfg;

void setup() {
	delay(3000); // safety check while powering up
  pinMode(LED_BUILTIN, OUTPUT);
  cfg = load_configuration();
  Serial.println(cfg.LED_PIN);
  Serial.println(cfg.LED_TYPE);
  
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
  digitalWrite(LED_BUILTIN, HIGH);
  delay(500);
  digitalWrite(LED_BUILTIN, LOW);
  delay(500);
}
