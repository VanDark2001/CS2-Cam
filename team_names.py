"""Demo team names keyed by the persisted roster, independent of side swaps."""
import json


def extract_team_names(parser, roster, official_tick=0):
    ends = parser.parse_event('round_end')
    ticks = sorted({int(row['tick']) for row in ends.to_dict(orient='records')
                    if int(row.get('tick', 0)) >= official_tick
                    and str(row.get('winner', '')).upper() in ('T', 'CT')})[-3:]
    if not ticks:
        return {}
    rows = parser.parse_ticks(['team_clan_name'], ticks=ticks).to_dict(orient='records')
    teams = {str(row['steamid']): int(row['team_number']) for row in roster
             if row.get('team_number') in (2, 3)}
    latest = {}
    for row in sorted(rows, key=lambda row: int(row['tick'])):
        sid = str(row.get('steamid'))
        name = row.get('team_clan_name')
        if sid in teams and isinstance(name, str) and name.strip():
            latest[sid] = name.strip()
    names = {}
    for team in (2, 3):
        candidates = {name for sid, name in latest.items() if teams[sid] == team}
        # Conflicting labels are unknown; never infer names from player nicknames.
        if len(candidates) == 1:
            names[str(team)] = candidates.pop()
    return names


def replace_team_names(connection, match_id, names):
    connection.execute("DELETE FROM events WHERE match_id=? AND event_name='match_team_names'", (match_id,))
    connection.execute(
        "INSERT INTO events(match_id,tick,event_name,is_warmup,data_json) VALUES(?,0,'match_team_names',0,?)",
        (match_id, json.dumps(names, ensure_ascii=False)))
