// This should eventually be replaced by a config file using a LittleFS filesystem. 
// Author: Jacob Parmer
// Date: Feb 7, 2021

const int NUM_PATTERNS = 1;

struct Config {
	int LED_PIN;
	int NUM_LEDS;
	int BRIGHTNESS;
	char const *LED_TYPE;
	char const *COLOR_ORDER;
	int UPDATES_PER_SECOND;
	char const *PATTERNS[NUM_PATTERNS] = {
		"blink"
	};
};


Config load_configuration() {
	
	Config cfg;

	cfg.LED_PIN = 5;
	cfg.NUM_LEDS = 63;
	cfg.BRIGHTNESS = 64;
	cfg.LED_TYPE = "WS2811";
	cfg.COLOR_ORDER = "GRB";
	cfg.UPDATES_PER_SECOND = 100;

	return cfg;
};
