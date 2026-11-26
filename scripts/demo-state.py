#!/usr/bin/env python3
# A believable ekho state for screenshots: a few people reached over LoRa
# and IRC, the mesh channel and a regional one, with every message state.
# Usage: demo-state.py [open-contact-id] [--first-run] > ~/.ekho/state.json
import json, sys, time

now = int(time.time() * 1000)
minute = 60_000
seq = [100]

def msg(contact, text, via, state, ago, sender=None, hops=None, reason=None, address=None):
    seq[0] += 1
    return {
        'id': seq[0], 'contact': contact, 'from': sender, 'text': text, 'via': via,
        'state': state, 'reason': reason, 'hops': hops,
        'address': address if address is not None else contact,
        'time': now - ago * minute
    }

ivan = {'id': '!a7c3e91f', 'name': 'Ivan Petrov', 'alias': 'Ivan', 'nodes': ['!a7c3e91f'], 'nicks': ['Ivan_Petrov|mt'], 'channel': False}
maria = {'id': '!5b0d2c44', 'name': 'Maria', 'alias': None, 'nodes': ['!5b0d2c44'], 'nicks': [], 'channel': False}
georgi = {'id': 'irc:georgi', 'name': 'georgi', 'alias': None, 'nodes': [], 'nicks': ['georgi'], 'channel': False}
mesh = {'id': '#bulgaria', 'name': '#bulgaria', 'alias': None, 'nodes': [], 'nicks': ['#bulgaria'], 'channel': True}
sofia = {'id': '#sofia', 'name': '#sofia', 'alias': None, 'nodes': [], 'nicks': ['#sofia'], 'channel': True}

threads = {
    ivan['id']: [
        msg(ivan['id'], 'are you coming to the meetup on saturday?', 'lora', 'received', 1500, hops=2),
        msg(ivan['id'], 'yes! bringing the spare T-Beam', 'lora', 'delivered', 1490),
        msg(ivan['id'], 'great, the hut has power now', 'lora', 'received', 42, hops=2),
        msg(ivan['id'], 'nice, solar finally in?', 'lora', 'delivered', 40),
        msg(ivan['id'], '200W panel and a 100Ah battery, relay runs all night', 'lora', 'received', 12, hops=1),
        msg(ivan['id'], 'the app I use: https://github.com/Casaide/ekho', 'lora', 'delivered', 8),
        msg(ivan['id'], 'https://www.youtube.com/watch?v=jqGIDP7ZqHg&list=PLdTsEXMtfOYM', 'irc', 'sent', 7),
        msg(ivan['id'], 'https://github.com/Casaide/ekho/blob/main/docs%2Fscreenshots%2Fphone-thread.png', 'irc', 'received', 6),
        msg(ivan['id'], 'from the hut: https://example.org/hut.mp3', 'irc', 'received', 5),
        msg(ivan['id'], 'leaving at 9, see you at the hut', 'lora', 'failed', 3, reason='MAX_RETRANSMIT'),
    ],
    maria['id']: [
        msg(maria['id'], 'node on the roof is up, can you hear me?', 'lora', 'received', 95, hops=0),
        msg(maria['id'], 'loud and clear, -97 dBm', 'lora', 'delivered', 93),
    ],
    georgi['id']: [
        msg(georgi['id'], 'saw your node on the map, nice coverage', 'irc', 'received', 300, address='georgi'),
        msg(georgi['id'], 'thanks! it is a T1000-E in my jacket pocket', 'irc', 'sent', 298, address='georgi'),
    ],
    mesh['id']: [
        msg(mesh['id'], 'Vitosha relay back up after the storm', 'lora', 'received', 30, sender='Vitosha relay', hops=3, address='channel 0'),
        msg(mesh['id'], 'anyone hearing Varna tonight?', 'irc', 'received', 8, sender='Plovdiv_GW|mt', address='#bulgaria'),
    ],
    sofia['id']: [
        msg(sofia['id'], 'meetup moved to the hut, 10:00', 'irc', 'received', 60, sender='ana', address='#sofia'),
    ],
}

args = [a for a in sys.argv[1:] if not a.startswith('--')]
state = {
    'messenger': {
        'contacts': [mesh, sofia, ivan, maria, georgi],
        'threads': threads,
        # Ivan's last message and Maria's are unread.
        'read': {georgi['id']: threads[georgi['id']][-1]['id'], mesh['id']: threads[mesh['id']][0]['id'], sofia['id']: threads[sofia['id']][-1]['id']},
    },
    'irc': {'nick': 'dom', 'password': ''},
    'wanted': {'radio': False, 'irc': False},
    'onboarded': '--first-run' not in sys.argv,
    'channels': ['#sofia'],
    'open': args[0] if args else None,
}
json.dump(state, sys.stdout, ensure_ascii=False, indent=1)
