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

# Used for Asynch Rx from SC
from pythonosc.osc_server import AsyncIOOSCUDPServer
import asyncio
import time

class OmniCollider:

    def __init__(self):
        self.midi_evnt = []

        self.last_two = []

    def rx_handler(self, *args):
        event = []
        for x in args:
            event.append(x)
        self.midi_evnt = event
        print(event)

    async def loop(self):
        # roughly 5ms delay
        for x in range(5):
            await asyncio.sleep(0.001)

    async def init_main(self):
        rx = argparse.ArgumentParser()
        rx.add_argument("--ip", default="127.0.0.1", help="osc default ip")
        rx.add_argument("--port", type=int, default=7771, help="supercollider tx osc port")
        rx_args = rx.parse_args()
        server = osc_server.AsyncIOOSCUDPServer(
            (rx_args.ip, rx_args.port), self.d, asyncio.get_event_loop())
        transport, protocol = await server.create_serve_endpoint()
        await self.loop()
        transport.close()

    def add_to_last_two(self, message):
        if len(self.last_two) < 2:
            self.last_two.append(message)
        else:
            temp = self.last_two[1]
            self.last_two = []
            self.last_two.append(temp)
            self.last_two.append(message)

    def is_duplicate(self):
        if len(self.last_two) == 2:
            if self.last_two[0] == self.last_two[1]:
                return True
        return False

    def receive(self, sc_variable):
        self.d = dispatcher.Dispatcher()
        self.d.map(sc_variable, self.rx_handler)
        asyncio.run(self.init_main())

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
            message = (command, control_block)
            self.add_to_last_two(message)
            if not self.is_duplicate():
                client.send_message(command, control_block)

if __name__ == "__main__":
    sc = OmniCollider()
