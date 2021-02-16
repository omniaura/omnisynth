#GUI built on the Kivy framework

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

#Creating very simple plot
plt.plot([1, 23, 2, 4])
plt.title('WaveForm')
plt.ylabel('yLabel')
plt.xlabel('xLabel')

# Creating the parent class for the screens and
# defining the functions they will need to share
class MyScreens(Screen):
    def screenSel(self, screenName):
        sm.current = screenName
    def toneSel(self, tone):
        OmniSynth.synth_sel(tone)

class MainGUI(MyScreens):
    OmniSynth.midi_learn_on = True
    event = Clock.schedule_interval(OmniSynth.open_stream, .001)

#extending FigureCanvasKivyAgg
class WaveForm(FigureCanvasKivyAgg):
    def __init__(self, **kwargs):
        super(WaveForm, self).__init__(plt.gcf(), **kwargs)


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



class OmniGui(ScreenManager):
    def __init__(self, **kwargs):
        super(OmniGui, self).__init__(**kwargs)
        #selecting the Main GUI screen for startup
        self.current = 'MainGUI'



class OmniApp(App):
    def build(self):
        global sm 
        sm = OmniGui(transition=NoTransition())

        return sm
    

if __name__ == "__main__":
    OmniApp().run()
    
