'''
Open Sound Control module for communicating with Supercollider.

author: Omar Barazanji
date: 1/17/2021

Python 3.7.x
'''

# used for receiving via OSC
import argparse
from pythonosc import dispatcher
from pythonosc import osc_server

# Used for sending via OSC
from pythonosc import udp_client

# used for sending bundles via OSC
from pythonosc import osc_bundle_builder
from pythonosc import osc_message_builder

class OmniCollider:

    def __init__(self):
        pass

    def receive(self, sc_variable):
        rx = argparse.ArgumentParser()
        rx.add_argument("--ip", default="127.0.0.1", help="osc default ip")
        rx.add_argument("--port", type=int, default=7771, help="supercollider tx osc port")
        rx_args = rx.parse_args()
        d = dispatcher.Dispatcher()
        d.map(sc_variable, print)
        server = osc_server.ThreadingOSCUDPServer(
            (rx_args.ip, rx_args.port), d)
        print("Serving on {}".format(server.server_address))
        server.serve_forever()

    def transmit(self, command, control, *args):
        port = 57120
        if (command == "server"): port = 57110
        tx = argparse.ArgumentParser()
        tx.add_argument("--ip", default="127.0.0.1", help="osc default ip")
        tx.add_argument("--port", type=int, default=port, help="supercollider rx osc port")
        tx_args = tx.parse_args()
        client = udp_client.SimpleUDPClient(tx_args.ip, tx_args.port)

        if command == "server":
            client.send_message(control, args[0])
        else:
            control_block = [control]
            for x in args:
                control_block.append(x)
            client.send_message(command, control_block)

if __name__ == "__main__":
    sc = OmniCollider()
