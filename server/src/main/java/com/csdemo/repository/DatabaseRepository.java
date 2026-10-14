package com.csdemo.repository;

import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Repository;
import org.sqlite.Function;
import org.sqlite.SQLiteConfig;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.*;
import java.util.Locale;
import java.util.Map;
import java.util.HashMap;

/** Both Java and Python use this one SQLite file. */
@Repository
public class DatabaseRepository {
  private final String url;
  private final Path file;

  public DatabaseRepository(@Value("${spring.datasource.url}") String url) {
    if(!url.startsWith("jdbc:sqlite:") || url.substring(12).isBlank())
      throw new IllegalArgumentException("A local SQLite database file is required");
    file=Path.of(url.substring(12)).toAbsolutePath().normalize();
    this.url="jdbc:sqlite:"+file;
  }

  @PostConstruct public void initialize() throws SQLException,IOException {
    Files.createDirectories(file.getParent());
    try(Connection c=connection();Statement s=c.createStatement()) {
      int version;
      try(ResultSet r=s.executeQuery("PRAGMA user_version")){r.next();version=r.getInt(1);}
      if(version>2)throw new SQLException("SQLite schema is newer than this application");
      if(version==2)return;
      s.execute("PRAGMA journal_mode=WAL");
      try(var input=DatabaseRepository.class.getResourceAsStream(version==1?"/sqlite_schema_v2.sql":"/sqlite_schema.sql")) {
        if(input==null)throw new IOException("Missing SQLite schema");
        c.setAutoCommit(false);
        try {
          for(String sql:new String(input.readAllBytes(),StandardCharsets.UTF_8).split(";"))
            if(!sql.isBlank())s.execute(sql);
          c.commit();
        } catch(SQLException e){c.rollback();throw e;}
      }
    }
  }

  public Connection connection() throws SQLException { return open(false); }
  /** Team labels are optional Demo metadata, keyed by the fixed roster teams. */
  public Map<String,String> teamNames(Connection c,long id) throws SQLException {
    Map<String,String> names=new HashMap<>();
    try(PreparedStatement ps=c.prepareStatement("SELECT JSON_EXTRACT(data_json,'$.\"2\"'),JSON_EXTRACT(data_json,'$.\"3\"') FROM events WHERE match_id=? AND event_name='match_team_names' ORDER BY id DESC LIMIT 1")) {
      ps.setLong(1,id);
      try(ResultSet rs=ps.executeQuery()){if(rs.next())for(int i=1;i<=2;i++){String name=rs.getString(i);if(name!=null&&!name.isBlank())names.put(String.valueOf(i+1),name.strip());}}
    }
    return names;
  }
  /** Null means blindness was not extracted; an empty map is a verified zero. */
  public Map<String,Integer> flashBlindCounts(Connection c,long id,long start,long end)throws SQLException {
    try(PreparedStatement ps=c.prepareStatement("SELECT 1 FROM events WHERE match_id=? AND event_name IN ('player_blind','flash_blinds_ready') LIMIT 1")) {
      ps.setLong(1,id);
      try(ResultSet rows=ps.executeQuery()){if(!rows.next())return null;}
    }
    Map<String,Integer> out=new HashMap<>();
    String sql="SELECT a.steamid,COUNT(*) FROM events e "
      +"JOIN match_players a ON a.match_id=e.match_id AND a.steamid=JSON_EXTRACT(e.data_json,'$.attacker_steamid') "
      +"JOIN match_players v ON v.match_id=e.match_id AND v.steamid=JSON_EXTRACT(e.data_json,'$.user_steamid') "
      +"WHERE e.match_id=? AND e.event_name='player_blind' AND e.tick BETWEEN ? AND ? "
      +"AND COALESCE(e.is_warmup,0)=0 AND a.team_number<>v.team_number AND a.steamid<>v.steamid "
      +"AND COALESCE(JSON_EXTRACT(e.data_json,'$.blind_duration'),1)>0 "
      +"AND COALESCE((SELECT JSON_EXTRACT(re.data_json,'$.winner') FROM events re WHERE re.match_id=e.match_id AND re.event_name='round_end' AND re.tick>=e.tick ORDER BY re.tick,re.id LIMIT 1),'') IN ('T','CT') "
      +"GROUP BY a.steamid";
    try(PreparedStatement ps=c.prepareStatement(sql)) {
      ps.setLong(1,id);ps.setLong(2,start);ps.setLong(3,end);
      try(ResultSet rows=ps.executeQuery()){while(rows.next())out.put(rows.getString(1),rows.getInt(2));}
    }
    return out;
  }
  public Connection bulkConnection() throws SQLException { return open(true); }
  /** Clear every statistics table together, allowing SQLite's whole-table truncate path. */
  public int clearStatistics() throws SQLException {
    try(Connection c=bulkConnection();Statement s=c.createStatement()) {
      // These settings apply only to this dedicated connection. All related tables
      // are emptied atomically, so per-row foreign-key cascades are unnecessary.
      s.execute("PRAGMA foreign_keys=OFF");
      s.execute("PRAGMA secure_delete=OFF");
      c.setAutoCommit(false);
      try {
        int count;
        try(ResultSet rs=s.executeQuery("SELECT COUNT(*) FROM matches")){rs.next();count=rs.getInt(1);}
        for(String table:new String[]{"damages","kills","events","bomb_events","player_positions","match_players","rounds","matches","players"})
          s.executeUpdate("DELETE FROM "+table);
        s.executeUpdate("DELETE FROM sqlite_sequence WHERE name IN ('matches','rounds','events','kills','damages','bomb_events','player_positions')");
        c.commit();
        return count;
      } catch(SQLException error) {
        c.rollback();
        throw error;
      }
    }
  }
  private Connection open(boolean writer) throws SQLException {
    SQLiteConfig config=new SQLiteConfig();
    config.enforceForeignKeys(true);config.setBusyTimeout(60000);
    config.setSynchronous(SQLiteConfig.SynchronousMode.FULL);
    config.setTransactionMode(writer?SQLiteConfig.TransactionMode.IMMEDIATE:SQLiteConfig.TransactionMode.DEFERRED);
    Connection c=DriverManager.getConnection(url,config.toProperties());
    try {
      Function.create(c,"normalized_weapon",new Function(){protected void xFunc() throws SQLException {
        String name=value_text(0);if(name==null){result();return;}
        name=name.trim().toLowerCase(Locale.ROOT).replaceFirst("^5e[_-]2024pass\\d*[_-]", "").replaceFirst("^5e[_-]", "").replaceFirst("(?:_txz\\d+|_vip)+$", "");
        if(name.equals("bayonet")||name.equals("knife")||name.startsWith("knife_"))name="knife";
        else if(java.util.Set.of("m4a1_silencer","m4a1silencer","m4a1slencer").contains(name))name="m4a1s";
        else if(name.equals("fiveseven"))name="fn57";
        result(name);
      }});
      Function.create(c,"demo_basename",new Function(){protected void xFunc() throws SQLException {
        String name=value_text(0);if(name==null){result();return;}
        name=name.replace('\\','/');result(name.substring(name.lastIndexOf('/')+1));
      }});
      return c;
    } catch(SQLException e){c.close();throw e;}
  }
  public String databaseFile(){return file.toString();}
  public void ensureDemoFingerprint(Connection c) throws SQLException {
    // Schema upgrades belong to the repository; normal starts already contain this column.
    try(Statement s=c.createStatement();ResultSet r=s.executeQuery("PRAGMA table_info(matches)")) {
      while(r.next())if("demo_sha256".equals(r.getString("name")))return;
    }
    try(Statement s=c.createStatement()){s.execute("ALTER TABLE matches ADD COLUMN demo_sha256 TEXT");}
  }
}
