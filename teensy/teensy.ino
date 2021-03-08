//#include <OctoWS2811.h>
//#include "src/config.h"
#include "src/usbMIDI_omni.h"

OmniMIDI thisMidiDevice = OmniMIDI();

//DMAMEM int displayMemory[64*6];
//int drawingMemory[64*6];

//const int config = WS2811_GRB | WS2811_800kHz;

//OctoWS2811 leds(ledsPerStrip, displayMemory, drawingMemory, config);

void setup() {
	delay(3000); // safety check while powering up
  Serial.begin(9600);
  pinMode(LED_BUILTIN, OUTPUT);

  //leds.begin();
  //leds.show();

  Serial.println("Starting Execution...");
}

void loop() {
  // put your main code here, to run repeatedly.
    //int microsec = 2000000 / leds.numPixels();
    //colorWipe(RED, microsec);
    //colorWipe(GREEN, microsec);
    thisMidiDevice.read();
}
