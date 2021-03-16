#GUI built on the Kivy framework

# config
from kivy.config import Config
Config.set('kivy', 'keyboard_mode', 'system')
Config.set('postproc', 'double_tap_time', '800')

# Enables referencing to packages in parent directory  #
#   Discovered this method online at codeolives.com    #
########################################################
import os, sys
currentdir = os.path.dirname(os.path.realpath(__file__))
parentdir = os.path.dirname(currentdir)
sys.path.append(parentdir)
########################################################

import kivy

from kivy.app import App
from kivy.uix.image import Image
from kivy.uix.label import Label
from kivy.uix.widget import Widget
from kivy.uix.button import Button
from kivy.uix.boxlayout import BoxLayout
from kivy.uix.anchorlayout import AnchorLayout
from kivy.uix.screenmanager import NoTransition
from kivy.uix.screenmanager import ScreenManager, Screen

from kivy.garden.matplotlib.backend_kivyagg import FigureCanvasKivyAgg
import matplotlib.pyplot as plt

# used for triggering events
from kivy.clock import Clock

from main import Omni
OmniSynth = Omni()

from kivy.core.window import Window
Window.fullscreen = 'auto'
Window.show_cursor = False

knobCoords = dict()

#Creating very simple plot
plt.plot([1, 23, 2, 4])
plt.title('WaveForm')
plt.ylabel('yLabel')
plt.xlabel('xLabel')

# Extending FigureCanvasKivyAgg for MatPlotLib
class WaveForm(FigureCanvasKivyAgg):
    def __init__(self, **kwargs):
        super(WaveForm, self).__init__(plt.gcf(), **kwargs)

# Creating the parent class for the screens and
# defining the functions they will need to share
class MyScreens(Screen):
    def screenSel(self, screenName):
        sm.current = screenName
    def toneSel(self, tone):
        OmniSynth.synth_sel(tone)

# Extending the Button class for Tone Buttons
class ToneButton(Button):
    def on_touch_down(self, touch):
        if self.collide_point(*touch.pos):
            OmniSynth.synth_sel(self.text)
            self.background_color = [0, 85, 255, 1]
            if touch.is_double_tap:
                sm.current = 'KnobValPage'
    def on_touch_up(self, touch):
        if self.collide_point(*touch.pos):
            self.background_color = [1, 1, 1, 1]


# Extending the Button class for LED Buttons
class LedButton(Button):
    def on_touch_down(self, touch):
        if self.collide_point(*touch.pos):
            self.background_color = [0, 85, 255, 1]
    def on_touch_up(self, touch):
        if self.collide_point(*touch.pos):
            self.background_color = [1, 1, 1, 1]

# Defining all the screens for ScreenManager
class MainGUI(MyScreens):
    pass
class PatchPage1(MyScreens):
    pass
class PatchPage2(MyScreens):
    pass
class PatchPage3(MyScreens):
    pass
class PatchPage4(MyScreens):
    pass
class LedPage1(MyScreens):
    pass
class LedPage2(MyScreens):
    pass
class LedPage3(MyScreens):
    pass
class LedPage4(MyScreens):
    pass
class WaveFormPage(MyScreens):
    pass
class MidiLearnPage(MyScreens):
    pass

# Extending Image class to associate each knob with a function name
# And allow midi learn to fully work
class KnobImage(Image):
    def __init__(self, name, **kwargs):
        self.knob_name = name
        super(KnobImage, self).__init__(**kwargs)
        with self.canvas:
            self.opacity = 0.5
    def on_touch_down(self, touch):
        if OmniSynth.midi_learn_on:
            if len(OmniSynth.knob_table) != 0:
                if self.collide_point(*touch.pos):
                    self.opacity = 1

class IndicatorImage(Image):
    def __init__(self, name, **kwargs):
        self.knob_name = name
        super(IndicatorImage, self).__init__(**kwargs)
        with self.canvas:
            self.opacity = 0.5
    def on_touch_down(self, touch):
        if self.collide_point(*touch.pos):
            if OmniSynth.midi_learn_on:
                if len(OmniSynth.knob_table) != 0:
                    with self.canvas:
                        self.opacity = 1
                    src = OmniSynth.evnt[2]
                    chan = OmniSynth.evnt[3]
                    knobCoords[self.knob_name] = (src, chan)
                    OmniSynth.map_knob((src,chan), self.knob_name)



class KnobValPage(MyScreens):
    def on_pre_enter(self):
        lpf_label = Label(text='LPF', pos_hint={'x':0.25, 'y':0.7})
        lpf_knob = KnobImage('lpf',source='knobV1.png', 
                            size_hint_x=0.25, size_hint_y=0.25,
                            pos_hint={'x':0.025, 'y':0.7})
        lpf_indicator = IndicatorImage('lpf', source='indicator.png',
                            size_hint_x=0.25, size_hint_y=0.25,
                            pos_hint={'x':0.024, 'y':0.7})

        hpf_label = Label(text="HPF", color=[105, 106, 188, 1],font_size=60, pos_hint={'x':0.225, 'y':0.7})
        hpf_knob = KnobImage('hpf', source='knobV1.png',
                            size_hint_x=0.25, size_hint_y=0.25,
                            pos_hint={'x':0.225, 'y':0.7})
        hpf_indicator = IndicatorImage('hpf', source='indicator.png',
                            size_hint_x=0.25, size_hint_y=0.25,
                            pos_hint={'x':0.224, 'y':0.7})
        self.add_widget(lpf_label)
        self.add_widget(lpf_knob)
        self.add_widget(lpf_indicator)
        self.add_widget(hpf_knob)
        self.add_widget(hpf_indicator)
        self.add_widget(hpf_label)
    def learnMidi(self):
        if OmniSynth.midi_learn_on:
            OmniSynth.midi_learn_on = False
        else:
            OmniSynth.midi_learn_on = True

class OmniGui(ScreenManager):
    def __init__(self, **kwargs):
        super(OmniGui, self).__init__(**kwargs)
        #selecting the Main GUI screen for startup
        self.current = 'MainGUI'

class OmniApp(App):
    def build(self):
        global sm
        sm = OmniGui(transition=NoTransition())
        event = Clock.schedule_interval(OmniSynth.open_stream, .001)
        return sm

if __name__ == "__main__":
    OmniApp().run()
    
