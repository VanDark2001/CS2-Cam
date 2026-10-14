import hashlib, json, math, os, re, subprocess, sys
from collections import Counter
from itertools import combinations
from datetime import datetime
from pathlib import Path
from demoparser2 import DemoParser
from db_schema import open_application_database
from match_scoring import score_round_winners
from steam_avatar_scraper import download_avatars
from replay_positions import position_stream, steamid as position_steamid, write_positions
from flash_blinds import extract_blinds, replace_blinds
from team_names import extract_team_names, replace_team_names

demo=Path(sys.argv[1]); stage_path=os.getenv('CS2_PARSE_STAGE_FILE')
def set_stage(name):
 try:
  if stage_path: Path(stage_path).write_text(name,encoding='utf-8')
 except Exception: pass
set_stage('parser init')
p=DemoParser(str(demo)); set_stage('header'); header=p.parse_header()
con=open_application_database(); c=con.cursor()
set_stage('database')
# Acquire SQLite's writer reservation before reading or replacing a match.
# Readers keep using the committed WAL snapshot; failures roll back all rows.
c.execute('BEGIN IMMEDIATE')
z=p.parse_events(['round_announce_match_start']); start_rows=z[0][1].to_dict(orient='records') if z else []; official_tick=int(start_rows[0].get('tick',0)) if start_rows else 0
set_stage('match metadata')
recorded_at=datetime.fromtimestamp(demo.stat().st_mtime).isoformat(sep=' ',timespec='seconds')
demo_sha256=os.getenv('DEMO_SHA256')
c.execute('SELECT id FROM matches WHERE demo_file_path=?',(str(demo),)); existing=c.fetchone()
if existing:
 mid=int(existing[0])
 for table in ('player_positions','kills','damages','bomb_events','events','rounds','match_players'): c.execute(f'DELETE FROM {table} WHERE match_id=?',(mid,))
 c.execute('UPDATE matches SET map_name=?,patch_version=?,server_name=?,warmup_end_tick=?,official_start_tick=?,recorded_at=?,recording_time_source=?,demo_sha256=? WHERE id=?',(header.get('map_name'),header.get('patch_version'),header.get('server_name'),official_tick,official_tick,recorded_at,'file_last_modified',demo_sha256,mid))
else:
 c.execute('INSERT INTO matches(demo_file_path,map_name,patch_version,server_name,warmup_end_tick,official_start_tick,recorded_at,recording_time_source,demo_sha256) VALUES(?,?,?,?,?,?,?,?,?)',(str(demo),header.get('map_name'),header.get('patch_version'),header.get('server_name'),official_tick,official_tick,recorded_at,'file_last_modified',demo_sha256)); mid=c.lastrowid
def clean(x):
 if isinstance(x,float) and (math.isnan(x) or math.isinf(x)): return None
 if isinstance(x,dict): return {k:clean(v) for k,v in x.items()}
 return x
def finite_number(value):
 try:
  value=float(value)
  return value if math.isfinite(value) else None
 except (TypeError,ValueError):
  return None
def normalize_weapon(name):
 if not isinstance(name,str): return name
 normalized=name.strip().lower()
 # 5E 活动地图会给武器追加 5E_2024PASS* 前缀，后面的 CS2 名称才是
 # 统计和图标需要使用的基础武器。保留后缀中的下划线，例如
 # 5E_2024PASS5_USP_SILENCER -> usp_silencer。
 normalized=re.sub(r'^5e[_-]2024pass\d*[_-]','',normalized,flags=re.IGNORECASE)
 normalized=re.sub(r'^5e[_-]','',normalized,flags=re.IGNORECASE)
 normalized=re.sub(r'(?:_txz\d+|_vip)+$','',normalized,flags=re.IGNORECASE)
 # Keep the concrete knife variant for replay presentation (for example
 # ``knife_skeleton``). Aggregation SQL still folds every knife variant into
 # the single ``knife`` bucket for statistics.
 if normalized in ('bayonet', 'knife') or normalized.startswith('knife_'): return normalized
 if normalized in ('m4a1_silencer','m4a1silencer','m4a1slencer'): return 'm4a1s'
 if normalized=='fiveseven': return 'fn57'
 return normalized
set_stage('roster')
player_rows=p.parse_player_info().to_dict(orient='records')
if not player_rows:
 fallback={}
 try:
  death_rows=p.parse_event('player_death',player=['team_num']).sort_values('tick').to_dict(orient='records')
  participants={}; opponent_edges=Counter()
  for row in death_rows:
   for prefix in ('attacker','user','assister'):
    sid=row.get(prefix+'_steamid'); team=row.get(prefix+'_team_num'); name=row.get(prefix+'_name')
    if sid is None or str(sid) in ('0','None','nan'): continue
    sid=str(sid); participants.setdefault(sid,{'steamid':sid,'name':name})
    if team in (2,3): fallback.setdefault(sid,{'steamid':sid,'name':name,'team_number':int(team)})
   attacker=row.get('attacker_steamid'); victim=row.get('user_steamid')
   if attacker is not None and victim is not None and str(attacker) not in ('0','None','nan') and str(victim) not in ('0','None','nan') and str(attacker)!=str(victim):
    opponent_edges[tuple(sorted((str(attacker),str(victim))))]+=1
  unknown=sorted(set(participants)-set(fallback)); known_counts=Counter(row['team_number'] for row in fallback.values())
  if len(participants)==10 and set(known_counts).issubset({2,3}) and known_counts[2]<=5 and known_counts[3]<=5 and len(unknown)==10-len(fallback):
   need_team2=5-known_counts[2]; candidates=[]
   for team2_members in combinations(unknown,need_team2):
    assigned={sid:row['team_number'] for sid,row in fallback.items()}; assigned.update({sid:(2 if sid in team2_members else 3) for sid in unknown})
    score=sum(weight for pair,weight in opponent_edges.items() if assigned.get(pair[0])!=assigned.get(pair[1]))
    candidates.append((score,tuple(team2_members),assigned))
   candidates.sort(key=lambda item:(-item[0],item[1]))
   if candidates and (len(candidates)==1 or candidates[0][0]>candidates[1][0]):
    for sid in unknown: fallback[sid]={**participants[sid],'team_number':candidates[0][2][sid]}
    print('[roster] recovered missing team numbers from unique 5v5 opponent graph:',','.join(unknown))
  player_rows=list(fallback.values())
  print('[roster] parse_player_info empty; recovered',len(player_rows),'players from player_death events')
 except Exception as exc:
  print('[roster] fallback failed:',exc,file=sys.stderr)
# Some DemoParser builds expose SteamIDs in player_info but omit names.
# Recover names from player_death event rows before writing the roster.
name_by_sid={}
try:
 for ev in p.parse_event('player_death').to_dict(orient='records'):
  if int(ev.get('tick',0) or 0) < official_tick: continue
  for prefix in ('attacker','user','assister'):
   sid=ev.get(prefix+'_steamid'); name=ev.get(prefix+'_name')
   if sid is not None and name not in (None,'','nan'): name_by_sid[str(sid)]=str(name)
except Exception: pass
for row in player_rows:
 sid=str(row.get('steamid')); profile_name=row.get('name') or sid; demo_name=name_by_sid.get(sid) or profile_name
 c.execute('INSERT INTO players(steamid,name) VALUES(?,?) ON CONFLICT(steamid) DO UPDATE SET name=COALESCE(players.name,excluded.name)',(sid,profile_name)); c.execute('INSERT INTO match_players(match_id,steamid,team_number,display_name) VALUES(?,?,?,?) ON CONFLICT(match_id,steamid) DO UPDATE SET team_number=excluded.team_number,display_name=excluded.display_name',(mid,sid,row.get('team_number'),demo_name))
set_stage('team names')
try:
 replace_team_names(con,mid,extract_team_names(p,player_rows,official_tick))
except Exception as exc:
 print('[team names] unavailable:',exc,file=sys.stderr)
# Keep the match, roster, ticks and events in one transaction. If any later
# parsing step fails, closing the connection rolls back the entire partial
# match instead of leaving a duplicate placeholder that blocks retry.
rounds=[]
set_stage('round boundaries')
for name in ['round_prestart','round_freeze_end','round_officially_ended']:
 try:
  z=p.parse_events([name]); rows=z[0][1].to_dict(orient='records') if z else []
 except Exception:
  rows=[]
 for row in rows:
  row=clean(row); tick=int(row.get('tick',0) or 0)
  if name in ('round_prestart','round_freeze_end'): c.execute('INSERT INTO rounds(match_id,tick,start_type,round_number,data_json) VALUES(?,?,?,?,?)',(mid,tick,name,len(rounds)+1,json.dumps(row,ensure_ascii=False,allow_nan=False))); rounds.append(c.lastrowid)
  else: c.execute('INSERT INTO rounds(match_id,tick,start_type,round_number,data_json) VALUES(?,?,?,?,?)',(mid,tick,name,len(rounds)+1,json.dumps(row,ensure_ascii=False,allow_nan=False))); rounds.append(c.lastrowid)
set_stage('positions')
position_roster=[row for row in player_rows if row.get('team_number') in (2,3)] or player_rows
position_sids={position_steamid(row.get('steamid')) for row in position_roster}-{''}
with position_stream(p,demo,official_tick,position_sids) as position_rows:
 position_counts=write_positions(c,position_rows,mid,official_tick,position_sids,normalize_weapon)
print('[positions] saved',sum(position_counts.values()),'snapshots for',len(position_counts),'players')
set_stage('events')
round_winners=[]; last_round_end_tick=0
for name in ['player_death','player_hurt','player_blind','bomb_planted','bomb_defused','bomb_exploded','bomb_beginplant','bomb_begindefuse','round_prestart','round_freeze_end','round_end','round_officially_ended','round_announce_match_start','cs_win_panel_match','player_connect_full','player_spawn','smokegrenade_detonate','smokegrenade_expired','inferno_startburn','inferno_expire','flashbang_detonate']:
 try:
  z=p.parse_event(name,player=['X','Y','Z']) if name in ('bomb_planted','smokegrenade_detonate','inferno_startburn','flashbang_detonate') else p.parse_events([name])
  rows=z.to_dict(orient='records') if hasattr(z,'to_dict') else (z[0][1].to_dict(orient='records') if z else [])
 except Exception as exc:
  print(f'[warn][events] {name} unavailable: {type(exc).__name__}: {exc}',file=sys.stderr)
  continue
 for row in rows:
  row=clean(row); raw=json.dumps(row,ensure_ascii=False,default=str,allow_nan=False); tick=int(row.get('tick',0) or 0); rid=None
  if name=='round_end' and str(row.get('winner','')).upper() in ('T','CT'):
   round_winners.append((int(row.get('round',0) or 0),str(row.get('winner')).upper()))
   last_round_end_tick=max(last_round_end_tick,tick)
  c.execute('INSERT INTO events(match_id,round_id,event_name,tick,player_steamid,player_name,is_warmup,data_json) VALUES(?,?,?,?,?,?,?,?)',(mid,rid,name,tick,row.get('user_steamid'),row.get('user_name'),tick < official_tick,raw))
  if name=='player_death': c.execute('INSERT INTO kills(match_id,round_id,tick,attacker_steamid,attacker_name,victim_steamid,victim_name,weapon,headshot,data_json) VALUES(?,?,?,?,?,?,?,?,?,?)',(mid,rid,tick,row.get('attacker_steamid'),row.get('attacker_name'),row.get('user_steamid'),row.get('user_name'),normalize_weapon(row.get('weapon')),bool(row.get('headshot',False)),raw))
  elif name=='player_hurt': c.execute('INSERT INTO damages(match_id,round_id,tick,attacker_steamid,attacker_name,victim_steamid,victim_name,health_damage,armor_damage,data_json) VALUES(?,?,?,?,?,?,?,?,?,?)',(mid,rid,tick,row.get('attacker_steamid'),row.get('attacker_name'),row.get('user_steamid'),row.get('user_name'),row.get('dmg_health'),row.get('dmg_armor'),raw))
  elif name.startswith('bomb_'): c.execute('INSERT INTO bomb_events(match_id,round_id,tick,event_name,player_steamid,player_name,site,data_json) VALUES(?,?,?,?,?,?,?,?)',(mid,rid,tick,name,row.get('user_steamid'),row.get('user_name'),row.get('site'),raw))
set_stage('flash blindness')
try:
 blind_rows=extract_blinds(demo,official_tick)
 replace_blinds(con,mid,official_tick,blind_rows)
 print('[flash-blinds] saved',len(blind_rows),'network-state events')
except Exception as exc:
 print('[warn][flash-blinds] unavailable:',exc,file=sys.stderr)
set_stage('statistics')
team_scores=score_round_winners([winner for _,winner in sorted(round_winners)])
c.execute("UPDATE matches SET final_score_t=?,final_score_ct=? WHERE id=?",(team_scores[2],team_scores[3],mid))
if last_round_end_tick:
 try:
  damage_rows=p.parse_ticks(['damage_total'],ticks=[last_round_end_tick]).to_dict(orient='records')
  for row in damage_rows:
   sid=str(row.get('steamid')); total=row.get('damage_total')
   if sid not in ('0','None','nan') and total is not None and not (isinstance(total,float) and math.isnan(total)):
    c.execute('UPDATE match_players SET total_damage=? WHERE match_id=? AND steamid=?',(max(0,int(total)),mid,sid))
 except Exception as exc:
  print('[stats] damage_total unavailable; ADR will use player_hurt fallback:',exc,file=sys.stderr)
set_stage('commit')
con.commit(); print('OK SQLite match_id',mid,'map',header.get('map_name')); con.close()
set_stage('replay effects')
# Optional visual streams run in a separate native-parser process, after the
# statistical transaction commits. A native crash must not lose the match.
try:
 result=subprocess.run([sys.executable,str(Path(__file__).with_name('replay_effects.py')),'--match',str(mid)],timeout=240)
 if result.returncode: print('[replay-effects] optional extraction failed:',result.returncode,file=sys.stderr)
except Exception as exc:
 print('[replay-effects] optional extraction skipped:',type(exc).__name__,file=sys.stderr)
set_stage('avatars')
try:
 print('Steam',download_avatars([str(row.get('steamid')) for row in player_rows]))
except Exception as exc:
 print('[avatar] skipped:',exc,file=sys.stderr)
