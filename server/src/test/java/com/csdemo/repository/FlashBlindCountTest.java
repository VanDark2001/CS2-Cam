package com.csdemo.repository;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Path;
import java.sql.*;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;

class FlashBlindCountTest {
  @TempDir Path directory;
  @Test void enemyBlindnessExcludesTeammatesSelfWarmupInvalidRoundsAndPostMatch() throws Exception {
    DatabaseRepository db=new DatabaseRepository("jdbc:sqlite:"+directory.resolve("flash.sqlite3"));db.initialize();
    try(Connection c=db.connection();Statement s=c.createStatement()) {
      s.execute("INSERT INTO matches(id) VALUES(1)");
      s.execute("INSERT INTO players(steamid) VALUES('1'),('2'),('3')");
      s.execute("INSERT INTO match_players(match_id,steamid,team_number) VALUES(1,'1',2),(1,'2',3),(1,'3',2)");
      assertNull(db.flashBlindCounts(c,1,100,300));
      event(c,"flash_blinds_ready",100,0,"{}");
      assertEquals(Map.of(),db.flashBlindCounts(c,1,100,300));
      event(c,"round_end",200,0,"{\"winner\":\"CT\"}");
      event(c,"round_end",250,0,"{\"winner\":\"UNKNOWN\"}");
      event(c,"round_end",300,0,"{\"winner\":\"T\"}");
      blind(c,150,0,"2",1);blind(c,280,0,"2",2); // two enemy victims
      blind(c,160,0,"3",1);blind(c,170,0,"1",1); // teammate and self
      blind(c,180,1,"2",1);blind(c,50,0,"2",1); // warmup
      blind(c,220,0,"2",1);blind(c,310,0,"2",1); // invalid round and post-match
      blind(c,190,0,"2",0); // zero-duration flash
      assertEquals(Map.of("1",2),db.flashBlindCounts(c,1,100,300));
    }
  }
  private void blind(Connection c,int tick,int warmup,String victim,int duration)throws Exception {
    event(c,"player_blind",tick,warmup,"{\"attacker_steamid\":\"1\",\"user_steamid\":\""+victim+"\",\"blind_duration\":"+duration+"}");
  }
  private void event(Connection c,String name,int tick,int warmup,String json)throws Exception {
    try(PreparedStatement ps=c.prepareStatement("INSERT INTO events(match_id,event_name,tick,is_warmup,data_json) VALUES(1,?,?,?,?)")) {
      ps.setString(1,name);ps.setInt(2,tick);ps.setInt(3,warmup);ps.setString(4,json);ps.executeUpdate();
    }
  }
}
