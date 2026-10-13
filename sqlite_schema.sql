-- Shared by Python and the Spring Boot repository. Statistics and IDs are unchanged.

CREATE TABLE IF NOT EXISTS matches(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            demo_file_path VARCHAR(768) UNIQUE,
            map_name VARCHAR(128),
            patch_version VARCHAR(64),
            server_name VARCHAR(255),
            final_score_t INT,
            final_score_ct INT,
            warmup_end_tick BIGINT,
            official_start_tick BIGINT,
            recorded_at DATETIME,
            recording_time_source VARCHAR(32),
            demo_sha256 CHAR(64),
            imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

CREATE TABLE IF NOT EXISTS players(steamid VARCHAR(32) NOT NULL PRIMARY KEY,name VARCHAR(255));

CREATE TABLE IF NOT EXISTS match_players(
            match_id BIGINT NOT NULL,
            steamid VARCHAR(32) NOT NULL,
            team_number INT,
            total_damage INT NULL,
            display_name VARCHAR(255),
            PRIMARY KEY(match_id,steamid),
            FOREIGN KEY(match_id) REFERENCES matches(id) ON DELETE CASCADE,
            FOREIGN KEY(steamid) REFERENCES players(steamid)
            );

CREATE TABLE IF NOT EXISTS rounds(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            match_id BIGINT,
            tick BIGINT,
            start_type VARCHAR(40),
            end_tick BIGINT NULL,
            round_number INT,
            data_json TEXT,
            FOREIGN KEY(match_id) REFERENCES matches(id) ON DELETE CASCADE
            );

CREATE TABLE IF NOT EXISTS events(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            match_id BIGINT,
            round_id BIGINT NULL,
            event_name VARCHAR(128),
            tick BIGINT,
            player_steamid VARCHAR(32),
            player_name VARCHAR(255),
            team_number INT,
            is_warmup BOOLEAN DEFAULT FALSE,
            data_json TEXT,
            FOREIGN KEY(match_id) REFERENCES matches(id) ON DELETE CASCADE
            );

CREATE TABLE IF NOT EXISTS kills(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            match_id BIGINT,
            round_id BIGINT NULL,
            tick BIGINT,
            attacker_steamid VARCHAR(32),
            attacker_name VARCHAR(255),
            victim_steamid VARCHAR(32),
            victim_name VARCHAR(255),
            weapon VARCHAR(128),
            headshot BOOLEAN,
            data_json TEXT,
            FOREIGN KEY(match_id) REFERENCES matches(id) ON DELETE CASCADE
            );

CREATE TABLE IF NOT EXISTS damages(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            match_id BIGINT,
            round_id BIGINT NULL,
            tick BIGINT,
            attacker_steamid VARCHAR(32),
            attacker_name VARCHAR(255),
            victim_steamid VARCHAR(32),
            victim_name VARCHAR(255),
            health_damage INT,
            armor_damage INT,
            data_json TEXT,
            FOREIGN KEY(match_id) REFERENCES matches(id) ON DELETE CASCADE
            );

CREATE TABLE IF NOT EXISTS bomb_events(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            match_id BIGINT,
            round_id BIGINT NULL,
            tick BIGINT,
            event_name VARCHAR(64),
            player_steamid VARCHAR(32),
            player_name VARCHAR(255),
            site VARCHAR(8),
            data_json TEXT,
            FOREIGN KEY(match_id) REFERENCES matches(id) ON DELETE CASCADE
            );

CREATE TABLE IF NOT EXISTS player_positions(
            id INTEGER PRIMARY KEY AUTOINCREMENT, match_id BIGINT NOT NULL,
            tick BIGINT NOT NULL, steamid VARCHAR(32) NOT NULL,
            x DOUBLE NULL, y DOUBLE NULL, z DOUBLE NULL, yaw DOUBLE NULL,
            health INT NULL, armor INT NULL, alive BOOLEAN NULL, team_number INT NULL,
            money INT NULL, weapon VARCHAR(64) NULL, inventory TEXT NULL,
            FOREIGN KEY(match_id) REFERENCES matches(id) ON DELETE CASCADE
            );

CREATE INDEX IF NOT EXISTS idx_rounds_match_id ON rounds(match_id);
CREATE INDEX IF NOT EXISTS idx_events_match_id ON events(match_id);
CREATE INDEX IF NOT EXISTS idx_events_round_id ON events(round_id);
CREATE INDEX IF NOT EXISTS idx_kills_match_id ON kills(match_id);
CREATE INDEX IF NOT EXISTS idx_damages_match_id ON damages(match_id);
CREATE INDEX IF NOT EXISTS idx_bomb_events_match_id ON bomb_events(match_id);
CREATE INDEX IF NOT EXISTS idx_positions_match_tick ON player_positions(match_id,tick);
CREATE INDEX IF NOT EXISTS idx_positions_player_tick ON player_positions(match_id,steamid,tick);
CREATE INDEX IF NOT EXISTS idx_events_match_name_tick ON events(match_id,event_name,tick);
CREATE INDEX IF NOT EXISTS idx_kills_match_tick ON kills(match_id,tick);
CREATE INDEX IF NOT EXISTS idx_damages_match_tick ON damages(match_id,tick);
CREATE INDEX IF NOT EXISTS idx_matches_demo_sha256 ON matches(demo_sha256);
PRAGMA user_version=2;
