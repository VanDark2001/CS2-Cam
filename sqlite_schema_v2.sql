-- Preserve MySQL's implicit NOT NULL primary keys in SQLite as well.
CREATE TABLE players_v2(
  steamid VARCHAR(32) NOT NULL PRIMARY KEY,
  name VARCHAR(255)
);
CREATE TABLE match_players_v2(
  match_id BIGINT NOT NULL,
  steamid VARCHAR(32) NOT NULL,
  team_number INT,
  total_damage INT,
  display_name VARCHAR(255),
  PRIMARY KEY(match_id,steamid),
  FOREIGN KEY(match_id) REFERENCES matches(id) ON DELETE CASCADE,
  FOREIGN KEY(steamid) REFERENCES players_v2(steamid)
);
INSERT INTO players_v2 SELECT steamid,name FROM players;
INSERT INTO match_players_v2 SELECT match_id,steamid,team_number,total_damage,display_name FROM match_players;
DROP TABLE match_players;
DROP TABLE players;
ALTER TABLE players_v2 RENAME TO players;
ALTER TABLE match_players_v2 RENAME TO match_players;
PRAGMA user_version=2;
