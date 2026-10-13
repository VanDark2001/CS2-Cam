package com.csdemo.repository;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Path;
import java.sql.*;
import static org.junit.jupiter.api.Assertions.*;

class SQLiteDatabaseTest {
  @TempDir Path directory;
  @Test void clearingStatisticsPreservesSchemaResetsIdsAndKeepsForeignKeysEnabled() throws Exception {
    DatabaseRepository db=new DatabaseRepository("jdbc:sqlite:"+directory.resolve("clear.sqlite3"));db.initialize();
    try(Connection c=db.connection();Statement s=c.createStatement()) {
      s.execute("INSERT INTO matches(id) VALUES(1)");
      s.execute("INSERT INTO players VALUES('1','player')");
      s.execute("INSERT INTO match_players(match_id,steamid) VALUES(1,'1')");
      s.execute("WITH RECURSIVE n(t) AS (SELECT 1 UNION ALL SELECT t+1 FROM n WHERE t<10000) INSERT INTO player_positions(match_id,tick,steamid) SELECT 1,t,'1' FROM n");
    }
    assertEquals(1,db.clearStatistics());
    try(Connection c=db.connection();Statement s=c.createStatement()) {
      for(String table:new String[]{"matches","players","match_players","player_positions"})
        try(ResultSet r=s.executeQuery("SELECT COUNT(*) FROM "+table)){r.next();assertEquals(0,r.getInt(1));}
      try(ResultSet r=s.executeQuery("PRAGMA foreign_keys")){r.next();assertEquals(1,r.getInt(1));}
      s.execute("INSERT INTO matches(map_name) VALUES('new')");
      try(ResultSet r=s.executeQuery("SELECT id FROM matches")){r.next();assertEquals(1,r.getInt(1));}
    }
  }

  @Test void failedClearRollsBackAllTables() throws Exception {
    DatabaseRepository db=new DatabaseRepository("jdbc:sqlite:"+directory.resolve("failed-clear.sqlite3"));db.initialize();
    try(Connection c=db.connection();Statement s=c.createStatement()) {
      s.execute("INSERT INTO matches(id) VALUES(1)");
      s.execute("INSERT INTO damages(match_id,tick) VALUES(1,1)");
      s.execute("CREATE TRIGGER refuse_clear BEFORE DELETE ON matches BEGIN SELECT RAISE(ABORT,'test failure'); END");
    }
    assertThrows(SQLException.class,db::clearStatistics);
    try(Connection c=db.connection();Statement s=c.createStatement()) {
      for(String table:new String[]{"matches","damages"})
        try(ResultSet r=s.executeQuery("SELECT COUNT(*) FROM "+table)){r.next();assertEquals(1,r.getInt(1));}
    }
  }
  @Test void schemaForeignKeysJsonNullsAndWeaponAggregationUseRealSQLite() throws Exception {
    DatabaseRepository db=new DatabaseRepository("jdbc:sqlite:"+directory.resolve("中文 数据.sqlite3"));
    db.initialize();db.initialize();
    try(Connection c=db.connection();Statement s=c.createStatement()){s.execute("PRAGMA user_version=1");}
    db.initialize();
    try(Connection c=db.connection();Statement s=c.createStatement()) {
      try(ResultSet r=s.executeQuery("PRAGMA user_version")){assertTrue(r.next());assertEquals(2,r.getInt(1));}
      assertThrows(SQLException.class,()->s.execute("INSERT INTO players(steamid) VALUES(NULL)"));
      try(ResultSet r=s.executeQuery("PRAGMA journal_mode")){assertTrue(r.next());assertEquals("wal",r.getString(1));}
      assertThrows(SQLException.class,()->s.execute("INSERT INTO match_players(match_id,steamid) VALUES(99,'missing')"));
      try(ResultSet r=s.executeQuery("SELECT json_extract('{\"winner\":\"CT\",\"x\":null}','$.winner'),json_extract('{\"x\":null}','$.x'),normalized_weapon('5E_2024PASS5_USP_SILENCER_txz12'),normalized_weapon('knife_m9_bayonet'),demo_basename('C:\\中文 目录\\demo.dem')")) {
        assertTrue(r.next());assertEquals("CT",r.getString(1));assertNull(r.getObject(2));
        assertEquals("usp_silencer",r.getString(3));assertEquals("knife",r.getString(4));assertEquals("demo.dem",r.getString(5));
      }
    }
  }
  @Test void writerRollbackLeavesNoPartialMatchAndConcurrentReadersRemainAvailable() throws Exception {
    DatabaseRepository db=new DatabaseRepository("jdbc:sqlite:"+directory.resolve("rollback.sqlite3"));db.initialize();
    try(Connection writer=db.bulkConnection();Connection reader=db.connection()) {
      writer.setAutoCommit(false);
      try(Statement s=writer.createStatement()){s.execute("INSERT INTO matches(id,map_name) VALUES(22,'de_ancient')");}
      try(Statement s=reader.createStatement();ResultSet r=s.executeQuery("SELECT COUNT(*) FROM matches")){assertTrue(r.next());assertEquals(0,r.getInt(1));}
      writer.rollback();
      try(Statement s=reader.createStatement();ResultSet r=s.executeQuery("SELECT COUNT(*) FROM matches")){assertTrue(r.next());assertEquals(0,r.getInt(1));}
    }
  }
}
