import json
import secrets
import threading
from pathlib import Path

from websockets.sync.server import serve
from websockets.exceptions import ConnectionClosed


class CaptureMonitor:
    """Receive recording provenance only from this local HLAE launch."""

    def __init__(self, output):
        self.output = Path(output)
        self.events = []
        self.token = secrets.token_urlsafe(24)
        self.lock = threading.Lock()

    def __enter__(self):
        # Demo loading can block CS2's scripting thread for more than 20 seconds.
        self.server = serve(self.receive, '127.0.0.1', 0, max_size=16384,
                            ping_interval=None, close_timeout=2)
        self.url = f'ws://127.0.0.1:{self.server.socket.getsockname()[1]}/{self.token}'
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        return self

    def __exit__(self, *args):
        self.server.shutdown()
        self.thread.join(timeout=5)

    def receive(self, connection):
        if connection.request.path != f'/{self.token}':
            connection.close(1008, 'wrong capture token')
            return
        try:
            for message in connection:
                event = json.loads(message)
                with self.lock:
                    self.events.append(event)
                    with (self.output / 'capture-events.jsonl').open('a', encoding='utf-8') as log:
                        log.write(json.dumps(event, ensure_ascii=False) + '\n')
        except ConnectionClosed:
            pass

    def validate(self, players, start_tick, end_tick):
        with self.lock:
            events = list(self.events)
        errors = [event for event in events if event.get('type') == 'error']
        if errors:
            raise RuntimeError(errors[-1].get('reason', 'POV observer validation failed'))
        if not any(event.get('type') == 'done' for event in events):
            raise RuntimeError('HLAE did not confirm batch completion; refusing partial POV output')
        for index, player in enumerate(players):
            starts = [event for event in events if event.get('type') == 'started'
                      and event.get('player') == index]
            ends = [event for event in events if event.get('type') == 'finished'
                    and event.get('player') == index]
            if (len(starts) != 1 or len(ends) != 1
                    or starts[0].get('steamid') != str(player['steamid'])
                    or starts[0].get('observedSteamid') != str(player['steamid'])
                    or starts[0].get('mode') != 2):
                raise RuntimeError(f'POV identity/mode was not verified for {player["steamid"]}')
            if (ends[0].get('steamid') != str(player['steamid'])
                    or ends[0].get('reason') != 'round_end'
                    or abs(starts[0].get('tick', -999) - start_tick) > 1
                    or not end_tick <= ends[0].get('tick', -999) <= end_tick + 2):
                raise RuntimeError(f'Full recording interval was not verified for {player["steamid"]}')
